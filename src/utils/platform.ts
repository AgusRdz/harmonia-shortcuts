import * as path from 'path';
import * as os from 'os';

/**
 * Gets the platform-specific path to VS Code's user keybindings.json
 */
export function getKeybindingsJsonPath(): string {
	const platform = process.platform;
	const homeDir = os.homedir();

	switch (platform) {
		case 'darwin':
			return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'keybindings.json');
		case 'win32':
			return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Code', 'User', 'keybindings.json');
		case 'linux':
			return path.join(homeDir, '.config', 'Code', 'User', 'keybindings.json');
		default:
			return path.join(homeDir, '.config', 'Code', 'User', 'keybindings.json');
	}
}

/**
 * Gets the platform-specific key modifier
 * Returns 'cmd' for macOS, 'ctrl' for others
 */
export function getPlatformModifier(): 'cmd' | 'ctrl' {
	return process.platform === 'darwin' ? 'cmd' : 'ctrl';
}

/**
 * Normalizes a key combination for the current platform
 */
export function normalizePlatformKey(key: string): string {
	const platform = process.platform;

	if (platform === 'darwin') {
		return key
			.replace(/\bctrl\b/gi, 'cmd')
			.replace(/\bmeta\b/gi, 'cmd');
	}

	return key
		.replace(/\bcmd\b/gi, 'ctrl')
		.replace(/\bmeta\b/gi, 'ctrl');
}

/**
 * Gets the platform-specific key from a keybinding entry
 */
export function getPlatformKey(keybinding: {
	key: string;
	mac?: string;
	win?: string;
	linux?: string;
}): string {
	const platform = process.platform;

	switch (platform) {
		case 'darwin':
			return keybinding.mac || keybinding.key;
		case 'win32':
			return keybinding.win || keybinding.key;
		case 'linux':
			return keybinding.linux || keybinding.key;
		default:
			return keybinding.key;
	}
}
