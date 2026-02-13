import * as vscode from 'vscode';
import {
	Keybinding,
	ExtensionKeybindings,
	generateKeybindingId,
	isNegationCommand,
} from '../types';
import { getPlatformKey } from '../utils/platform';
import { KeybindingsFileService } from './keybindingsFileService';

/**
 * Raw keybinding from extension package.json
 */
interface RawExtensionKeybinding {
	key: string;
	command: string;
	when?: string;
	mac?: string;
	win?: string;
	linux?: string;
	args?: unknown;
}

/**
 * Service for parsing keybindings from all sources
 */
export class KeybindingParser {
	constructor(private readonly fileService: KeybindingsFileService) {}

	/**
	 * Gets all user-defined keybindings from keybindings.json
	 */
	async getUserKeybindings(): Promise<Keybinding[]> {
		const entries = await this.fileService.read();
		const keybindings: Keybinding[] = [];

		for (const entry of entries) {
			if (isNegationCommand(entry.command)) {
				continue;
			}

			const keybinding: Keybinding = {
				id: generateKeybindingId(entry.key, entry.command, entry.when),
				key: entry.key,
				command: entry.command,
				when: entry.when,
				source: 'user',
				args: entry.args,
			};

			keybindings.push(keybinding);
		}

		return keybindings;
	}

	/**
	 * Gets all keybindings contributed by installed extensions
	 */
	getExtensionKeybindings(): ExtensionKeybindings[] {
		const result: ExtensionKeybindings[] = [];

		for (const extension of vscode.extensions.all) {
			const contributes = extension.packageJSON?.contributes;
			if (!contributes?.keybindings) {
				continue;
			}

			const rawBindings: RawExtensionKeybinding[] = Array.isArray(contributes.keybindings)
				? contributes.keybindings
				: [contributes.keybindings];

			if (rawBindings.length === 0) {
				continue;
			}

			const keybindings: Keybinding[] = rawBindings.map(raw => {
				const key = getPlatformKey(raw);
				return {
					id: generateKeybindingId(key, raw.command, raw.when),
					key,
					command: raw.command,
					when: raw.when,
					source: 'extension' as const,
					extensionId: extension.id,
					extensionName: extension.packageJSON?.displayName || extension.id,
					mac: raw.mac,
					win: raw.win,
					linux: raw.linux,
					args: raw.args,
				};
			});

			result.push({
				id: extension.id,
				name: extension.packageJSON?.displayName || extension.id,
				version: extension.packageJSON?.version || '0.0.0',
				keybindings,
			});
		}

		return result;
	}

	/**
	 * Gets all keybindings from all extensions as a flat list
	 */
	getAllExtensionKeybindings(): Keybinding[] {
		const extensionBindings = this.getExtensionKeybindings();
		return extensionBindings.flatMap(ext => ext.keybindings);
	}

	/**
	 * Gets all keybindings from all sources
	 */
	async getAllKeybindings(): Promise<{
		user: Keybinding[];
		extension: Keybinding[];
	}> {
		const [user, extension] = await Promise.all([
			this.getUserKeybindings(),
			Promise.resolve(this.getAllExtensionKeybindings()),
		]);

		return { user, extension };
	}

	/**
	 * Gets the set of commands that have been negated in keybindings.json
	 */
	async getNegatedCommands(): Promise<Set<string>> {
		const entries = await this.fileService.read();
		const negated = new Set<string>();

		for (const entry of entries) {
			if (isNegationCommand(entry.command)) {
				negated.add(entry.command.substring(1));
			}
		}

		return negated;
	}

	/**
	 * Gets keybindings for a specific extension
	 */
	getKeybindingsForExtension(extensionId: string): Keybinding[] {
		const extension = vscode.extensions.getExtension(extensionId);
		if (!extension) {
			return [];
		}

		const contributes = extension.packageJSON?.contributes;
		if (!contributes?.keybindings) {
			return [];
		}

		const rawBindings: RawExtensionKeybinding[] = Array.isArray(contributes.keybindings)
			? contributes.keybindings
			: [contributes.keybindings];

		return rawBindings.map(raw => {
			const key = getPlatformKey(raw);
			return {
				id: generateKeybindingId(key, raw.command, raw.when),
				key,
				command: raw.command,
				when: raw.when,
				source: 'extension' as const,
				extensionId: extension.id,
				extensionName: extension.packageJSON?.displayName || extension.id,
				mac: raw.mac,
				win: raw.win,
				linux: raw.linux,
				args: raw.args,
			};
		});
	}

	/**
	 * Gets a map of extension ID to version for all extensions with keybindings
	 */
	getExtensionVersions(): Record<string, string> {
		const versions: Record<string, string> = {};

		for (const extension of vscode.extensions.all) {
			const contributes = extension.packageJSON?.contributes;
			if (contributes?.keybindings) {
				versions[extension.id] = extension.packageJSON?.version || '0.0.0';
			}
		}

		return versions;
	}
}
