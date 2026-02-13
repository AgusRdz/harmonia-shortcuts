import * as vscode from 'vscode';

/**
 * Source of a keybinding
 */
export type KeybindingSource = 'user' | 'extension' | 'default';

/**
 * Governance status for a keybinding
 */
export type GovernanceStatus = 'pending' | 'approved' | 'deactivated' | 'remapped' | 'skipped';

/**
 * Raw keybinding from VS Code or extensions
 */
export interface Keybinding {
	/** Unique identifier generated from key + command + when */
	id: string;
	/** The key combination (e.g., "ctrl+shift+k") */
	key: string;
	/** The command to execute */
	command: string;
	/** Optional when clause */
	when?: string;
	/** Source of this keybinding */
	source: KeybindingSource;
	/** Extension ID if source is 'extension' */
	extensionId?: string;
	/** Extension display name */
	extensionName?: string;
	/** Mac-specific key override */
	mac?: string;
	/** Windows-specific key override */
	win?: string;
	/** Linux-specific key override */
	linux?: string;
	/** Arguments passed to the command */
	args?: unknown;
}

/**
 * A keybinding with governance state attached
 */
export interface GovernedKeybinding extends Keybinding {
	/** Current governance status */
	status: GovernanceStatus;
	/** Original key if remapped */
	originalKey?: string;
	/** New key if remapped */
	remappedKey?: string;
	/** Timestamp when decision was made */
	decidedAt?: number;
}

/**
 * A conflict between two or more keybindings
 */
export interface KeybindingConflict {
	/** The conflicting key combination */
	key: string;
	/** Keybindings that share this key */
	bindings: Keybinding[];
	/** Whether this conflict involves a user-defined keybinding */
	involvesUserBinding: boolean;
}

/**
 * Extension info with its keybindings
 */
export interface ExtensionKeybindings {
	/** Extension ID */
	id: string;
	/** Extension display name */
	name: string;
	/** Extension version */
	version: string;
	/** Keybindings contributed by this extension */
	keybindings: Keybinding[];
}

/**
 * Entry in user's keybindings.json
 */
export interface UserKeybindingEntry {
	key: string;
	command: string;
	when?: string;
	args?: unknown;
}

/**
 * Generates a unique ID for a keybinding
 */
export function generateKeybindingId(key: string, command: string, when?: string): string {
	const input = `${key}|${command}|${when ?? ''}`;
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		const char = input.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash;
	}
	return Math.abs(hash).toString(16).padStart(8, '0').substring(0, 16);
}

/**
 * Normalizes a key combination for comparison
 */
export function normalizeKey(key: string): string {
	return key
		.toLowerCase()
		.split('+')
		.map(part => part.trim())
		.sort()
		.join('+');
}

/**
 * Checks if a command is a negation (starts with -)
 */
export function isNegationCommand(command: string): boolean {
	return command.startsWith('-');
}

/**
 * Gets the base command from a potentially negated command
 */
export function getBaseCommand(command: string): string {
	return command.startsWith('-') ? command.substring(1) : command;
}
