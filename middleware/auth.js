const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const authenticateJwt = (req, res, next) => {
  let token;

  // First check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  // Fallback: check query parameter
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.sendStatus(401); // No token provided
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // Token invalid
    }
    req.user = user;
    next();
  });
};

module.exports = {
  authenticateJwt,
  JWT_SECRET
};
