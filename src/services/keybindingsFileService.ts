import * as vscode from 'vscode';
import * as fs from 'fs';
import { getKeybindingsJsonPath } from '../utils/platform';
import { UserKeybindingEntry } from '../types';

/**
 * Service for reading and writing the user's keybindings.json file
 */
export class KeybindingsFileService {
	private readonly filePath: string;

	constructor() {
		this.filePath = getKeybindingsJsonPath();
	}

	/**
	 * Gets the path to keybindings.json
	 */
	getFilePath(): string {
		return this.filePath;
	}

	/**
	 * Checks if keybindings.json exists
	 */
	async exists(): Promise<boolean> {
		try {
			await fs.promises.access(this.filePath, fs.constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Reads the raw content of keybindings.json
	 */
	async readRaw(): Promise<string> {
		try {
			return await fs.promises.readFile(this.filePath, 'utf-8');
		} catch {
			return '[]';
		}
	}

	/**
	 * Reads and parses keybindings.json
	 */
	async read(): Promise<UserKeybindingEntry[]> {
		const content = await this.readRaw();
		return this.parseKeybindings(content);
	}

	/**
	 * Parses keybindings JSON content, handling comments
	 */
	private parseKeybindings(content: string): UserKeybindingEntry[] {
		try {
			const cleanContent = this.stripJsonComments(content);
			const parsed = JSON.parse(cleanContent);
			return Array.isArray(parsed) ? parsed : [];
		} catch (error) {
			console.error('Failed to parse keybindings.json:', error);
			return [];
		}
	}

	/**
	 * Strips JSON comments (VS Code supports JSONC)
	 */
	private stripJsonComments(content: string): string {
		let result = '';
		let inString = false;
		let inLineComment = false;
		let inBlockComment = false;

		for (let i = 0; i < content.length; i++) {
			const char = content[i];
			const nextChar = content[i + 1];

			if (inString) {
				result += char;
				if (char === '"' && content[i - 1] !== '\\') {
					inString = false;
				}
			} else if (inLineComment) {
				if (char === '\n') {
					inLineComment = false;
					result += char;
				}
			} else if (inBlockComment) {
				if (char === '*' && nextChar === '/') {
					inBlockComment = false;
					i++;
				}
			} else if (char === '"') {
				inString = true;
				result += char;
			} else if (char === '/' && nextChar === '/') {
				inLineComment = true;
				i++;
			} else if (char === '/' && nextChar === '*') {
				inBlockComment = true;
				i++;
			} else {
				result += char;
			}
		}

		return result;
	}

	/**
	 * Writes keybindings to the file
	 */
	async write(keybindings: UserKeybindingEntry[]): Promise<void> {
		const content = JSON.stringify(keybindings, null, 2);
		await fs.promises.writeFile(this.filePath, content, 'utf-8');
	}

	/**
	 * Adds a keybinding entry to the file
	 */
	async addEntry(entry: UserKeybindingEntry): Promise<void> {
		const keybindings = await this.read();
		keybindings.push(entry);
		await this.write(keybindings);
	}

	/**
	 * Removes a keybinding entry by key and command
	 */
	async removeEntry(key: string, command: string): Promise<boolean> {
		const keybindings = await this.read();
		const index = keybindings.findIndex(
			kb => kb.key === key && kb.command === command
		);

		if (index === -1) {
			return false;
		}

		keybindings.splice(index, 1);
		await this.write(keybindings);
		return true;
	}

	/**
	 * Adds a negation entry to deactivate a keybinding
	 */
	async deactivateKeybinding(key: string, command: string, when?: string): Promise<void> {
		const entry: UserKeybindingEntry = {
			key,
			command: `-${command}`,
		};
		if (when) {
			entry.when = when;
		}
		await this.addEntry(entry);
	}

	/**
	 * Removes a negation entry to restore a deactivated keybinding
	 */
	async restoreKeybinding(key: string, command: string, when?: string): Promise<boolean> {
		const keybindings = await this.read();
		const negatedCommand = `-${command}`;

		const index = keybindings.findIndex(kb => {
			const keyMatches = kb.key === key;
			const commandMatches = kb.command === negatedCommand;
			const whenMatches = when ? kb.when === when : !kb.when;
			return keyMatches && commandMatches && whenMatches;
		});

		if (index === -1) {
			return false;
		}

		keybindings.splice(index, 1);
		await this.write(keybindings);
		return true;
	}

	/**
	 * Adds a remap entry (negation + new binding)
	 * Cleans up any previous remap entries for the same command first
	 */
	async remapKeybinding(
		originalKey: string,
		newKey: string,
		command: string,
		when?: string
	): Promise<void> {
		let keybindings = await this.read();
		const negatedCommand = `-${command}`;

		// Remove any existing entries for this command (both negations and positive bindings)
		// This prevents duplicates when re-remapping
		keybindings = keybindings.filter(kb => {
			const isNegation = kb.command === negatedCommand;
			const isPositive = kb.command === command;
			// Keep entries that are not related to this command
			return !isNegation && !isPositive;
		});

		const negationEntry: UserKeybindingEntry = {
			key: originalKey,
			command: negatedCommand,
		};
		if (when) {
			negationEntry.when = when;
		}

		const newEntry: UserKeybindingEntry = {
			key: newKey,
			command,
		};
		if (when) {
			newEntry.when = when;
		}

		keybindings.push(negationEntry, newEntry);
		await this.write(keybindings);
	}

	/**
	 * Removes all remap entries for a command (both negation and positive binding)
	 */
	async removeRemapEntries(command: string): Promise<boolean> {
		const keybindings = await this.read();
		const negatedCommand = `-${command}`;
		const originalLength = keybindings.length;

		const filtered = keybindings.filter(kb => {
			return kb.command !== negatedCommand && kb.command !== command;
		});

		if (filtered.length < originalLength) {
			await this.write(filtered);
			return true;
		}
		return false;
	}

	/**
	 * Opens keybindings.json in the editor
	 */
	async openInEditor(): Promise<void> {
		const uri = vscode.Uri.file(this.filePath);
		await vscode.window.showTextDocument(uri);
	}
}
