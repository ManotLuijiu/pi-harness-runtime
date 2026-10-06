#!/usr/bin/env bun
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: process.env.PLANNER_API_KEY,
  temperature: 0.2,
});

console.log("Testing OpenAI with LangChain...");

const response = await model.invoke("Say hello");
console.log("Success:", response.content);
process.exit(0);
