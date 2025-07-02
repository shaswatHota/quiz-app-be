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
    totalScore: Number,
    accuracy: Number,
    bestStreak: Number,
    gamePlayed: Number,
});

const UserModel = mongoose.model('quiz-users', UserSchema);
const StatsModel = mongoose.model('quiz-stats',StatsSchema);

module.exports = {
    UserModel,
    StatsModel
}