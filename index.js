import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import axios from "axios";
import bcrypt, { hash } from "bcrypt";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import env from "dotenv";
import { supabase } from "./utils/supabase.js";

const app = express();
const saltRounds = 10;
env.config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false, // set to false so a session is not created until something is stored
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(cors({ credentials: true, origin: "http://localhost:5173" })); // allow frontend to send cookies
app.use(express.json());

app.use(passport.initialize());
app.use(passport.session());

app.post("/login", passport.authenticate("local"), (req, res) => {
  res.sendStatus(200);
});

app.post("/newproject", async (req, res) => {
  //console.log(req.body);
  const title = req.body.title;
  const description = req.body.description;
  const userId = req.body.userId;
  try {
    const { data, error } = await supabase
      .from("projects")
      .insert({ title: title, description: description, userId: userId });
    console.log("Submitted project!");
    res.sendStatus(200);
  } catch (error) {
    console.log(error);
  }
});

app.get("/test", (req, res) => {
  res.json({
    message: "working finely",
  });
});

app.get("/project/:id", async (req, res) => {
  const projectId = req.params.id;

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, title, description, userId")
      .eq("id", projectId)
      .single(); // returns a single object instead of an array

    if (error) {
      console.error("Error fetching project:", error);
      return res.status(500).json({ message: "Failed to fetch project" });
    }

    if (!data) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({ project: data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/fetchprojects", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, title, description")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ projects: data });
  } catch (error) {
    console.log(error);
  }
});

app.post("/fetchuserprojects", async (req, res) => {
  const userId = req.body.userId;

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, title")
      .eq("userId", userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ projects: data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, cb) => {
      try {
        const { data: user, error } = await supabase
          .from("users")
          .select("*")
          .eq("email", email)
          .single();

        if (error || !user) {
          return cb(null, false, { message: "No user found with that email" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return cb(null, false, { message: "Incorrect password" });
        }

        return cb(null, user); // Login success
      } catch (err) {
        return cb(err);
      }
    }
  )
);

app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const { data, error } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .single();

    console.log(data);
    if (data) {
      console.log("user already exists");
      return res.status(400).send("User with this email already exists!");
    } else {
      console.log("welcome new user");
      bcrypt.hash(password, saltRounds, async (error, hash) => {
        if (error) {
          console.log("Error hasing the password: ", error);
        } else {
          const { data, error } = await supabase
            .from("users")
            .insert({
              name: name,
              email: email,
              password: hash,
            })
            .select();
          const user = data[0];
          console.log("Signup successful : ", user);
        }
      });
    }
  } catch (error) {
    console.log(error);
  }
});

//Check if user is authenticated
app.get("/auth/check", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email,
      },
    });
  } else {
    res.json({ authenticated: false });
  }
});

app.post("/logout", (req, res, next) => {
  req.logout(function (error) {
    if (error) return next(error);

    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.sendStatus(200);
      console.log("logged out successfully!");
    });
  });
});

// Serialize user by ID
passport.serializeUser((user, cb) => {
  cb(null, user.id); // Store only user ID in session
});

// Deserialize user by ID
passport.deserializeUser(async (id, cb) => {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !user) {
      return cb(new Error("User not found"));
    }

    cb(null, user); // Attach full user object to req.user
  } catch (err) {
    cb(err);
  }
});

app.listen(3000, () => console.log("Server running on port 3000."));
