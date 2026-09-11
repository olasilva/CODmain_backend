const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User'); // Adjust path as needed
// const Student = require('../models/Student'); // If auto-creating student profiles

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/api/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      let user = await User.findOne({ where: { email } });

      if (!user) {
        user = await User.create({
          googleId: profile.id,
          email: email,
          name: profile.displayName,
          role: 'student' // or determine dynamically
        });

        // Optional: Auto-create student profile to prevent "Student record not found" errors
        // await Student.create({ userId: user.id, name: user.name });
      } else if (!user.googleId) {
        // Link existing account to Google
        user.googleId = profile.id;
        await user.save();
      }

      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

// If using sessions (needed for passport.authenticate), serialize/deserialize
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findByPk(id);
  done(null, user);
});

module.exports = passport;