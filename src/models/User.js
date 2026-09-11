const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User'); 
// const Student = require('../models/Student'); // Uncomment if you have a Student model

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/api/auth/google/callback', // Must match Google Console
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;

        // 1. Check if user already exists
        let user = await User.findOne({ where: { email } });

        if (user) {
          // 2. If user exists but hasn't linked Google yet, link it
          if (!user.googleId) {
            user.googleId = profile.id;
            await user.save();
          }
        } else {
          // 3. Create a new user
          user = await User.create({
            googleId: profile.id,
            email: email,
            name: profile.displayName,
            role: 'student', // Default role for Google sign-ups
            password: null,  // No password for OAuth users
          });

          // 4. IMPORTANT: Auto-create Student profile to prevent "Student record not found" error
          // Uncomment and adjust this if you have a Student model tied to User
          /*
          if (user.role === 'student') {
            await Student.create({
              userId: user.id,
              name: user.name,
              email: user.email,
            });
          }
          */
        }

        return done(null, user);
      } catch (error) {
        console.error('Google OAuth Error:', error);
        return done(error, null);
      }
    }
  )
);

// Required for Passport session handshake (even though we use JWT)
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;