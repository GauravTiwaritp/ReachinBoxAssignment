const express = require("express");
require("dotenv").config();
const app = express();
const gmailRoutes = require("./routes/gmailRoutes");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/gmail", gmailRoutes);
app.listen(process.env.PORT || 3000, () => {
  console.log("Server is running on port 3000");
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});
