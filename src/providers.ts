import * as os from 'os';
import * as path from 'path';

export interface AgentProvider {
	id: 'claude' | 'codex';
	displayName: string;
	terminalNamePrefix: string;
	buildLaunchCommand: (sessionId: string) => string;
	resolveProjectDir: (workspacePath: string) => string;
}

function sanitizeWorkspacePath(workspacePath: string): string {
	return workspacePath.replace(/[:\\/]/g, '-');
}

const claudeProvider: AgentProvider = {
	id: 'claude',
	displayName: 'Claude Code',
	terminalNamePrefix: 'Claude Code',
	buildLaunchCommand: (sessionId) => `claude --session-id ${sessionId}`,
	resolveProjectDir: (workspacePath) => {
		const dirName = sanitizeWorkspacePath(workspacePath);
		return path.join(os.homedir(), '.claude', 'projects', dirName);
	},
};

const codexProvider: AgentProvider = {
	id: 'codex',
	displayName: 'Codex',
	terminalNamePrefix: 'Codex',
	buildLaunchCommand: (sessionId) => `codex --session-id ${sessionId}`,
	resolveProjectDir: (workspacePath) => {
		const dirName = sanitizeWorkspacePath(workspacePath);
		return path.join(os.homedir(), '.codex', 'projects', dirName);
	},
};

export function getActiveAgentProvider(): AgentProvider {
	const raw = process.env.PIXEL_AGENTS_PROVIDER?.trim().toLowerCase();
	if (raw === 'codex') {
		return codexProvider;
	}
	return claudeProvider;
}
