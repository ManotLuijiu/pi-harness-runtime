#!/usr/bin/env bun
import { getLatestSession, getVisibleMessages, classifyMessage } from '../packages/codex-watcher/dist/src/index.js';

const session = getLatestSession();
console.log('Latest session:', session?.id, session?.threadName);

if (session) {
  console.log('Rollout path:', session.rolloutPath);
  const messages = await getVisibleMessages(session.rolloutPath, { limit: 10 });
  console.log('Total messages:', messages.length);
  
  const recentMsgs = messages.slice(-10);
  for (const msg of recentMsgs) {
    const cls = classifyMessage(msg.text);
    console.log(`  [${msg.role}] ${cls}: "${msg.text.slice(0, 80)}..."`);
  }
  
  // Check for plan messages
  const planMessages = recentMsgs.filter((m: { text: string }) => classifyMessage(m.text) === 'plan');
  console.log('\nPlan messages found:', planMessages.length);
} else {
  console.log('No active session found');
}
