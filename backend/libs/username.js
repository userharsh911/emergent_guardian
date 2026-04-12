import crypto from "crypto"

export const generateUsername = (name) => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${name}_${date}_${random}`;
};