const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = mongoose.ObjectId;

const UserSchema = new Schema({
    username: String,
    email   : {type : String,unique : true},
    password: String
});

const StatsSchema = new Schema({
    userId: ObjectId,
    quizId: {type: String, required : true},
    totalScore: { type: Number, default: 0 },
    totalCorrect: { type: Number, default: 0 },
    totalWrong: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    accuracy: {type:Number, default:0}
});

const UserModel = mongoose.model('quiz-users', UserSchema);
const StatsModel = mongoose.model('quiz-stats',StatsSchema);

module.exports = {
    UserModel,
    StatsModel
}