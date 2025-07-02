// index.js

const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
require("dotenv").config();
const { UserModel, StatsModel } = require("./db"); // Assuming this file exports both models
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET; // Best practice to use .env
const bcryptjs = require('bcryptjs');
const { authenticateJwt } = require('./middleware/auth');

mongoose.connect(process.env.MONGODB_CONNECTION_STRING);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- Globals ---
const sessions = {}; // In-memory store for active quiz sessions
const allQuestions = JSON.parse(fs.readFileSync('./data.json', 'utf-8'));
const QUIZ_LIMIT = 20;

// =================================================================
// AUTHENTICATION ROUTES (No changes needed)
// =================================================================

app.get('/me', authenticateJwt, async (req, res) => {
    try {
        const user = await UserModel.findById(req.user.id).select('username email');
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post('/signup', async function (req, res) {
    const { username, email, password } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ message: 'Username, email, and password are required' });
    }

    try {
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email is already in use' });
        }

        const hashedPassword = await bcryptjs.hash(password, 10);
        await UserModel.create({
            username,
            email,
            password: hashedPassword
        });
        res.status(201).json({ message: "User created successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error during signup" });
    }
});

app.post('/signin', async function (req, res) {
    const { email, password } = req.body;

    try {
        const user = await UserModel.findOne({ email });
        if (user && await bcryptjs.compare(password, user.password)) {
            const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });
            res.json({ token });
        } else {
            res.status(401).json({ message: "Invalid email or password" });
        }
    } catch (error) {
        res.status(500).json({ message: "Server error during signin" });
    }
});

// =================================================================
// REFACTORED QUIZ LOGIC
// =================================================================

// --- Helper Functions ---

/**
 * [MODIFIED] Gets the next question, now with category awareness.
 */
function getNextQuestion(session) {
    // 1. Filter out questions that have already been seen
    let availableQuestions = allQuestions.filter(q => !session.seenIds.includes(q.id));

    // 2. Filter by category, if one was specified for the session
    // If category is 'general' or not provided, it will use all available questions.
    if (session.category && session.category.toLowerCase() !== 'general') {
        availableQuestions = availableQuestions.filter(q => q.category && q.category.toLowerCase() === session.category.toLowerCase());
    }

    if (availableQuestions.length === 0) {
        return null; // No more questions available for this criteria
    }

    // 3. Apply adaptive difficulty logic to the remaining pool
    let preferredQuestions = availableQuestions.filter(q => q.difficulty === session.currentDifficulty);
    if (preferredQuestions.length === 0) {
        preferredQuestions = availableQuestions.filter(q => Math.abs(q.difficulty - session.currentDifficulty) === 1);
    }
    if (preferredQuestions.length === 0) {
        preferredQuestions = availableQuestions;
    }

    const question = preferredQuestions[Math.floor(Math.random() * preferredQuestions.length)];
    return { id: question.id, question: question.question, options: question.options };
}

async function updateOverallStats(session) {
    try {
        await StatsModel.findOneAndUpdate({ userId: session.userId }, {
            $inc: {
                gamesPlayed: 1,
                totalScore: session.score,
                totalCorrect: session.correct,
                totalWrong: session.wrong
            },
            $max: { bestStreak: session.bestStreakInGame }
        }, { new: true, upsert: true });
        console.log(`Stats updated for user: ${session.userId}`);
    } catch (error) {
        console.error("Failed to update overall stats:", error);
    }
}


// --- API Routes ---

/**
 * [NEW] Returns a list of all available quiz categories.
 * This helps the frontend display the category selection options dynamically.
 */
app.get("/quiz/categories", (req, res) => {
    // Use a Set to ensure we only get unique category names
    const categories = [...new Set(allQuestions.map(q => q.category).filter(Boolean))];
    res.json({ categories });
});


/**
 * [MODIFIED] Starts a new quiz session, accepting a category, and returns the first question.
 */
app.post("/quiz/start", authenticateJwt, (req, res) => {
    const userId = req.user.id;
    const { category } = req.body; // Expects a category, e.g., "Science", "Technology"
    const quizId = uuidv4();

    sessions[quizId] = {
        userId,
        category: category || 'general', // Default to 'general' if no category is provided
        score: 0,
        correct: 0,
        wrong: 0,
        seenIds: [],
        currentDifficulty: 3,
        currentStreak: 0,
        bestStreakInGame: 0,
        isCompleted: false
    };

    const firstQuestion = getNextQuestion(sessions[quizId]);
    
    if (!firstQuestion) {
        return res.status(404).json({ error: "Could not load any questions for the selected category. Please try another one." });
    }
    
    sessions[quizId].seenIds.push(firstQuestion.id);

    res.json({
        message: `Quiz started in category: ${sessions[quizId].category}!`,
        quizId,
        question: firstQuestion
    });
});

/**
 * [REFACTORED] Submits an answer, gets the result, and receives the next question.
 * This is the main endpoint used during a quiz. (No code change needed here, it relies on the modified helper)
 */
app.post("/quiz/answer/:quizId", authenticateJwt, (req, res) => {
    try {
        const { quizId } = req.params;
        const { questionId, answer } = req.body;
        const userId = req.user.id;
        const session = sessions[quizId];

        if (!session || session.userId !== userId || session.isCompleted) {
            return res.status(404).json({ error: 'Quiz session not found, not yours, or already completed.' });
        }

        const question = allQuestions.find(q => q.id === questionId);
        if (!question) {
            return res.status(404).json({ error: 'Question not found.' });
        }

        const isCorrect = question.answer === answer;
        let resultMessage = "";

        if (isCorrect) {
            session.score += question.points || 10; // Use question points or default to 10
            session.correct++;
            session.currentStreak++;
            session.currentDifficulty = Math.min(5, session.currentDifficulty + 1);
            resultMessage = "Correct!";
        } else {
            session.wrong++;
            session.currentStreak = 0;
            session.currentDifficulty = Math.max(1, session.currentDifficulty - 1);
            resultMessage = `Wrong! Correct answer: ${question.answer}`;
        }
        session.bestStreakInGame = Math.max(session.bestStreakInGame, session.currentStreak);

        // Check if the quiz is over
        if (session.seenIds.length >= QUIZ_LIMIT) {
            session.isCompleted = true;
            updateOverallStats(session);
            return res.json({
                message: "Quiz Completed!",
                result: resultMessage,
                finalStats: {
                    quizId,
                    score: session.score,
                    correct: session.correct,
                    wrong: session.wrong,
                    bestStreak: session.bestStreakInGame
                }
            });
        }

        const nextQuestion = getNextQuestion(session);
        if (!nextQuestion) {
            session.isCompleted = true;
            updateOverallStats(session);
            return res.json({ 
                message: "Quiz Completed! No more questions available in this category.", 
                result: resultMessage,
                finalStats: {
                    quizId,
                    score: session.score,
                    correct: session.correct,
                    wrong: session.wrong,
                    bestStreak: session.bestStreakInGame
                }
            });
        }
        session.seenIds.push(nextQuestion.id);

        res.json({
            result: resultMessage,
            yourScore: session.score,
            nextQuestion
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

/**
 * [IMPROVED] Gets a user's overall, persistent statistics from the database.
 */
app.get("/stats", authenticateJwt, async (req, res) => {
    try {
        const userId = req.user.id;
        const stats = await StatsModel.findOne({ userId });

        if (!stats) {
            return res.json({
                message: "No stats found. Complete a game to see your stats!",
                stats: { gamesPlayed: 0, totalScore: 0, totalCorrect: 0, totalWrong: 0, accuracy: "0.00%", bestStreak: 0 }
            });
        }

        const { gamesPlayed, totalScore, totalCorrect, totalWrong, bestStreak } = stats;
        const totalAnswers = totalCorrect + totalWrong;
        const accuracy = totalAnswers > 0 ? ((totalCorrect / totalAnswers) * 100).toFixed(2) : "0.00";

        res.json({
            message: "Overall user statistics retrieved.",
            stats: { gamesPlayed, totalScore, totalCorrect, totalWrong, accuracy: `${accuracy}%`, bestStreak }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve user statistics.' });
    }
});

/**
 * [NEW] Gets the temporary results of a specific completed quiz.
 */
app.get("/quiz/result/:quizId", authenticateJwt, (req, res) => {
    const { quizId } = req.params;
    const userId = req.user.id;
    const session = sessions[quizId];
    
    if (!session || session.userId !== userId || !session.isCompleted) {
        return res.status(404).json({ error: 'Completed quiz session not found or not accessible.' });
    }

    res.json({
        message: "Results for the completed quiz.",
        quizId,
        stats: {
            score: session.score,
            correct: session.correct,
            wrong: session.wrong,
            bestStreakInGame: session.bestStreakInGame,
            category: session.category
        }
    });
});

// Start the server
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));