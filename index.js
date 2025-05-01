const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Express on Vercel get owrking perfectly");
});

app.get("/test", (req, res) => {
  res.json({ message: "test working perfectly" });
});

app.listen(3000, () => console.log("Server ready on port 3000."));

module.exports = app;
