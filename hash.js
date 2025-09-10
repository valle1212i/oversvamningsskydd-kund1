// hash.js
import bcrypt from "bcrypt";

const password = "Harryboy145454";

bcrypt.hash(password, 12).then(hash => {
  console.log("Hash:", hash);
});
