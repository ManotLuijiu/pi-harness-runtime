// harness/ssh-detach-interceptor.ts
function findLastSshCommand(s) {
  const matches = [...s.matchAll(/\bssh\s+/gm)];
  if (matches.length === 0)
    return null;
  const lastMatch = matches[matches.length - 1];
  const sshStart = lastMatch.index;
  let sshEnd = s.length;
  let depth = 0;
  for (let i = sshStart;i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      i++;
      continue;
    }
    if (depth > 0) {
      if (ch === '"' && depth === 1 || ch === "'" && depth === 2) {
        depth = 0;
      }
    } else if (ch === '"')
      depth = 1;
    else if (ch === "'")
      depth = 2;
    else if (ch === "|") {
      sshEnd = i;
      break;
    }
  }
  return { start: sshStart, end: sshEnd };
}
function isSshCommand(command) {
  return /\bssh\s+/m.test(command.trim());
}
function isDetachedPattern(command) {
  const sshRange = findLastSshCommand(command);
  if (!sshRange)
    return false;
  const sshPart = command.slice(sshRange.start, sshRange.end);
  return /nohup\b/.test(sshPart) && (/>\s*\//.test(sshPart) || /2>&1/.test(sshPart)) && /echo\s+['"]?\w+['"]?\s*$/.test(command.trim());
}
function hasBareAmpersand(command) {
  if (!isSshCommand(command))
    return false;
  if (isDetachedPattern(command))
    return false;
  const sshRange = findLastSshCommand(command);
  if (!sshRange)
    return false;
  const sshPart = command.slice(sshRange.start, sshRange.end);
  let remoteCmdEnd = sshPart.length;
  for (let i = sshPart.length - 1;i >= 0; i--) {
    if (sshPart[i] === "\\" && i > 0) {
      i--;
      continue;
    }
    if (sshPart[i] === '"' || sshPart[i] === "'") {
      const closeQuote = sshPart[i];
      let found = false;
      for (let j = i - 1;j >= 0; j--) {
        if (sshPart[j] === "\\") {
          j--;
          continue;
        }
        if (sshPart[j] === closeQuote) {
          found = true;
          break;
        }
      }
      if (found) {
        remoteCmdEnd = i + 1;
        break;
      }
    }
  }
  const afterQuotes = sshPart.slice(remoteCmdEnd).trim();
  return /^\s*&\s*$/.test(afterQuotes);
}
function hasCommandChainWithAmpersand(command) {
  if (!isSshCommand(command))
    return false;
  if (isDetachedPattern(command))
    return false;
  const sshRange = findLastSshCommand(command);
  if (!sshRange)
    return false;
  const sshPart = command.slice(sshRange.start, sshRange.end);
  const quoteMatch = sshPart.match(/['"](.+?)['"]\s*$/s);
  if (!quoteMatch)
    return false;
  const quotedContent = quoteMatch[1];
  const trimmed = quotedContent.trim();
  return /&&.+\s+&\s*$/.test(trimmed) || /;.+\s+&\s*$/.test(trimmed);
}
function transformToDetached(command, config = {}) {
  const { logFile = "/tmp/herdr-ssh.log" } = config;
  if (isDetachedPattern(command))
    return command;
  const sshRange = findLastSshCommand(command);
  if (!sshRange)
    return command;
  const beforeSsh = command.slice(0, sshRange.start);
  const sshPart = command.slice(sshRange.start, sshRange.end);
  const afterSsh = command.slice(sshRange.end);
  function findClosingQuotePos(s) {
    for (let i = s.length - 1;i >= 0; i--) {
      if (s[i] === "\\" && i > 0) {
        i--;
        continue;
      }
      if (s[i] === '"' || s[i] === "'") {
        const cq = s[i];
        let found = false;
        for (let j = i - 1;j >= 0; j--) {
          if (s[j] === "\\") {
            j--;
            continue;
          }
          if (s[j] === cq) {
            found = true;
            break;
          }
        }
        if (found)
          return i + 1;
      }
    }
    return s.length;
  }
  function findClosingQuotePosExcl(s) {
    for (let i = s.length - 1;i >= 0; i--) {
      if (s[i] === "\\" && i > 0) {
        i--;
        continue;
      }
      if (s[i] === '"' || s[i] === "'") {
        const cq = s[i];
        let found = false;
        for (let j = i - 1;j >= 0; j--) {
          if (s[j] === "\\") {
            j--;
            continue;
          }
          if (s[j] === cq) {
            found = true;
            break;
          }
        }
        if (found)
          return i;
      }
    }
    return s.length;
  }
  const remoteCmdEnd1 = findClosingQuotePos(sshPart);
  const sshPrefix = sshPart.slice(0, remoteCmdEnd1).trimEnd();
  const afterRemoteCmd = sshPart.slice(remoteCmdEnd1);
  if (/^\s*&\s*$/.test(afterRemoteCmd.trim())) {
    return beforeSsh + sshPrefix + ` nohup '' > ${logFile} 2>&1 & echo 'SSH_DETACHED'` + afterSsh;
  }
  let openQuotePos = -1;
  for (let i = 0;i < sshPart.length; i++) {
    if (sshPart[i] === "'" || sshPart[i] === '"') {
      openQuotePos = i;
      break;
    }
  }
  if (openQuotePos < 0)
    return command;
  const remoteCmdEnd2 = findClosingQuotePosExcl(sshPart);
  const beforeQuote = sshPart.slice(0, remoteCmdEnd2);
  const chainMatch2 = beforeQuote.match(/(.+?)(&&|;)\s*(.+?)\s+(2>&1)\s*&\s*$/);
  if (chainMatch2) {
    return beforeSsh + chainMatch2[1] + chainMatch2[2] + ` nohup ${chainMatch2[3]} ${chainMatch2[4]} & echo 'SSH_DETACHED'"`;
  }
  const chainMatch = beforeQuote.match(/(.+?)(&&|;)\s*(.+?)\s*&\s*$/);
  if (chainMatch) {
    return beforeSsh + chainMatch[1] + chainMatch[2] + ` nohup ${chainMatch[3]} > ${logFile} 2>&1 & echo 'SSH_DETACHED'"`;
  }
  return command;
}
function detectSsh(command) {
  const ssh = isSshCommand(command);
  const detached = ssh ? isDetachedPattern(command) : false;
  const bare = ssh ? hasBareAmpersand(command) : false;
  return {
    isSsh: ssh,
    isDetached: detached,
    hasBareAmpersand: bare,
    suggestion: ssh && !detached && bare ? "Warning: trailing '&' outside quotes backgrounds SSH itself. Use nohup ... > /tmp/log 2>&1 & echo DONE." : ssh && !detached ? "Use detached SSH pattern: nohup ... > /tmp/log 2>&1 & echo DONE." : ""
  };
}
export {
  transformToDetached,
  isSshCommand,
  isDetachedPattern,
  hasCommandChainWithAmpersand,
  hasBareAmpersand,
  detectSsh
};
