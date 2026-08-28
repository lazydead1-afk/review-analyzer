import Groq from "groq-sdk";

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  throw new Error("GROQ_API_KEY is missing.");
}

export const groq = new Groq({
  apiKey,
  maxRetries: 0,
});
