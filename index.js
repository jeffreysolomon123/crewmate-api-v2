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
import RedisStore from "connect-redis";
import { createClient } from "redis";

const app = express();
const saltRounds = 10;
env.config();

// Initialize Redis client
let redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.connect().catch(console.error);

redisClient.on("error", (err) => {
  console.log("Redis error:", err);
});

redisClient.on("connect", () => {
  console.log("Connected to Redis");
});

// Initialize Redis store
const redisStore = new RedisStore({
  client: redisClient,
  prefix: "crewmate:",
});

// Session middleware with Redis store
app.use(
  session({
    store: redisStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 day
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    },
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    credentials: true,
    origin: [
      "https://crewmate-neon.vercel.app",
      "http://localhost:3000", // for local testing
    ],
  })
);
app.use(express.json());

app.use(passport.initialize());
app.use(passport.session());

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    redis: redisClient.isReady ? "connected" : "disconnected",
    time: new Date().toISOString(),
  });
});

// Passport serialization/deserialization with logging
passport.serializeUser((user, cb) => {
  console.log("Serializing user:", user.id);
  cb(null, user.id);
});

passport.deserializeUser(async (id, cb) => {
  console.log("Deserializing user:", id);
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !user) {
      console.log("User not found during deserialization");
      return cb(new Error("User not found"));
    }

    console.log("Deserialized user:", user.email);
    cb(null, user);
  } catch (err) {
    console.log("Deserialization error:", err);
    cb(err);
  }
});

// Enhanced login route with better error handling
app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      console.error("Authentication error:", err);
      return next(err);
    }
    if (!user) {
      console.log("Login failed:", info?.message);
      return res.status(401).json({ message: info?.message || "Login failed" });
    }
    req.logIn(user, (err) => {
      if (err) {
        console.error("Login error:", err);
        return next(err);
      }
      console.log("Login successful for:", user.email);
      return res.json({
        message: "Login successful",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    });
  })(req, res, next);
});

// All your existing routes remain the same from here...
app.post("/newproject", async (req, res) => {
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
    res.status(500).json({ error: "Failed to create project" });
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
      .single();

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
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/delete/:id", async (req, res) => {
  const user = req.user;
  const projectId = req.params.id;

  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data: project, error: fetchError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (fetchError || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (project.userId !== user.id) {
      return res
        .status(403)
        .json({ error: "Forbidden: You are not the owner." });
    }

    const { error: deleteError } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId);

    if (deleteError) {
      throw deleteError;
    }

    res.json({ message: "Project deleted successfully." });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Server error while deleting project." });
  }
});

app.post("/messagepost", async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data, error } = await supabase.from("messages").insert({
      message: req.body.message,
      senderId: req.body.senderId,
      receiverId: req.body.receiverId,
      senderEmail: req.body.senderEmail,
      projectId: req.body.projectId,
      senderName: req.body.senderName,
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    return res.status(200).json({ message: "Message sent successfully" });
  } catch (error) {
    console.log("Server error while sending message", error);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/getmessages", async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data, error } = await supabase
      .from("messages")
      .select("message, senderEmail, senderName")
      .eq("receiverId", req.body.userId);

    if (error) {
      console.error("Supabase retrieve error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    return res.status(200).json({ Messages: data });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/edit/:id", async (req, res) => {
  const projectId = req.params.id;
  const user = req.user;

  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data: project, error } = await supabase
      .from("projects")
      .select("id, title, description, userId")
      .eq("id", projectId)
      .single();

    if (error || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (project.userId !== user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json({ project });
  } catch (err) {
    console.error("Error fetching project:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/edit/:id", async (req, res) => {
  const projectId = req.params.id;
  const { title, description } = req.body;

  try {
    const { error } = await supabase
      .from("projects")
      .update({ title, description })
      .eq("id", projectId);

    if (error) return res.status(500).json({ error: error.message });

    res.status(200).json({ message: "Project updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/getname", async (req, res) => {
  try {
    const projectId = req.body.projectId;

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select("userId")
      .eq("id", projectId)
      .single();

    if (projectError || !projectData) {
      return res
        .status(500)
        .json({ error: projectError?.message || "Project not found" });
    }

    const projectUserId = projectData.userId;

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("name, email,id")
      .eq("id", projectUserId)
      .single();

    if (userError || !userData) {
      return res
        .status(500)
        .json({ error: userError?.message || "User not found" });
    }

    res.status(200).json({ projectUserDetails: userData });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/fetchuserprojects", async (req, res) => {
  const userId = req.body.userId;

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, title , description")
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

        return cb(null, user);
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

    if (data) {
      console.log("user already exists");
      return res.status(400).send("User with this email already exists!");
    } else {
      console.log("welcome new user");
      bcrypt.hash(password, saltRounds, async (error, hash) => {
        if (error) {
          console.log("Error hashing the password: ", error);
          return res.status(500).json({ error: "Error creating user" });
        } else {
          const { data, error } = await supabase
            .from("users")
            .insert({
              name: name,
              email: email,
              password: hash,
            })
            .select();

          if (error) {
            console.log("Supabase error:", error);
            return res.status(500).json({ error: "Error creating user" });
          }

          const user = data[0];
          console.log("Signup successful:", user);
          return res.status(200).json({ message: "Signup successful", user });
        }
      });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/auth/check", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}.`));
