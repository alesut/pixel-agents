import * as vscode from 'vscode';
import * as fs from 'fs';

const CLAUDE_TERMINAL_PATTERN = /^Claude Code #(\d+)$/;

class ArcadiaViewProvider implements vscode.WebviewViewProvider {
	private nextId = 1;
	private terminals = new Map<number, vscode.Terminal>();
	private webviewView: vscode.WebviewView | undefined;

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		// Adopt any existing Claude Code terminals
		this.adoptExistingTerminals();

		webviewView.webview.onDidReceiveMessage((message) => {
			if (message.type === 'openClaude') {
				const id = this.nextId++;
				const terminal = vscode.window.createTerminal(`Claude Code #${id}`);
				terminal.show();
				terminal.sendText('claude');
				this.terminals.set(id, terminal);
				webviewView.webview.postMessage({ type: 'agentCreated', id });
			} else if (message.type === 'focusAgent') {
				const terminal = this.terminals.get(message.id);
				if (terminal) {
					terminal.show();
				}
			} else if (message.type === 'closeAgent') {
				const terminal = this.terminals.get(message.id);
				if (terminal) {
					terminal.dispose();
				}
			} else if (message.type === 'webviewReady') {
				this.sendExistingAgents();
			}
		});

		// Clean up buttons when terminals are closed
		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, terminal] of this.terminals) {
				if (terminal === closed) {
					this.terminals.delete(id);
					webviewView.webview.postMessage({ type: 'agentClosed', id });
					break;
				}
			}
		});

		// Detect Claude Code terminals opened outside the extension
		vscode.window.onDidOpenTerminal((terminal) => {
			const match = terminal.name.match(CLAUDE_TERMINAL_PATTERN);
			if (match && !this.isTracked(terminal)) {
				const id = parseInt(match[1], 10);
				this.terminals.set(id, terminal);
				if (id >= this.nextId) {
					this.nextId = id + 1;
				}
				webviewView.webview.postMessage({ type: 'agentCreated', id });
			}
		});
	}

	private adoptExistingTerminals() {
		for (const terminal of vscode.window.terminals) {
			const match = terminal.name.match(CLAUDE_TERMINAL_PATTERN);
			if (match) {
				const id = parseInt(match[1], 10);
				this.terminals.set(id, terminal);
				if (id >= this.nextId) {
					this.nextId = id + 1;
				}
			}
		}
	}

	private sendExistingAgents() {
		if (!this.webviewView) { return; }
		const ids = Array.from(this.terminals.keys()).sort((a, b) => a - b);
		if (ids.length > 0) {
			this.webviewView.webview.postMessage({ type: 'existingAgents', ids });
		}
	}

	private isTracked(terminal: vscode.Terminal): boolean {
		for (const t of this.terminals.values()) {
			if (t === terminal) { return true; }
		}
		return false;
	}
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new ArcadiaViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('arcadia.panelView', provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('arcadia.showPanel', () => {
			vscode.commands.executeCommand('arcadia.panelView.focus');
		})
	);
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	// Rewrite asset paths to use webview URIs
	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}

export function deactivate() {}
