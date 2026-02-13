import { Keybinding, KeybindingConflict, normalizeKey } from '../types';

/**
 * Service for detecting keybinding conflicts
 */
export class ConflictService {
	/**
	 * Detects conflicts between keybindings
	 * A conflict occurs when multiple keybindings use the same key combination
	 */
	detectConflicts(
		userBindings: Keybinding[],
		extensionBindings: Keybinding[]
	): KeybindingConflict[] {
		const allBindings = [...userBindings, ...extensionBindings];
		const keyMap = new Map<string, Keybinding[]>();

		for (const binding of allBindings) {
			const normalizedKey = normalizeKey(binding.key);
			const existing = keyMap.get(normalizedKey) || [];
			existing.push(binding);
			keyMap.set(normalizedKey, existing);
		}

		const conflicts: KeybindingConflict[] = [];

		for (const [key, bindings] of keyMap) {
			if (bindings.length > 1) {
				const contextGroups = this.groupByContext(bindings);

				for (const group of contextGroups) {
					if (group.length > 1) {
						conflicts.push({
							key: group[0].key,
							bindings: group,
							involvesUserBinding: group.some(b => b.source === 'user'),
						});
					}
				}
			}
		}

		return conflicts;
	}

	/**
	 * Groups bindings by their when context
	 * Bindings with different non-overlapping contexts don't conflict
	 */
	private groupByContext(bindings: Keybinding[]): Keybinding[][] {
		const groups: Keybinding[][] = [];
		const processed = new Set<number>();

		for (let i = 0; i < bindings.length; i++) {
			if (processed.has(i)) continue;

			const group: Keybinding[] = [bindings[i]];
			processed.add(i);

			for (let j = i + 1; j < bindings.length; j++) {
				if (processed.has(j)) continue;

				if (this.contextsOverlap(bindings[i].when, bindings[j].when)) {
					group.push(bindings[j]);
					processed.add(j);
				}
			}

			groups.push(group);
		}

		return groups;
	}

	/**
	 * Checks if two when contexts can overlap
	 * This is a simplified check - full context evaluation is complex
	 */
	private contextsOverlap(when1?: string, when2?: string): boolean {
		if (!when1 && !when2) return true;
		if (!when1 || !when2) return true;

		const conditions1 = this.parseWhenConditions(when1);
		const conditions2 = this.parseWhenConditions(when2);

		for (const [key, value] of conditions1) {
			const otherValue = conditions2.get(key);
			if (otherValue !== undefined && otherValue !== value) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Parses simple when conditions into a map
	 * Handles basic equality conditions like "editorTextFocus"
	 */
	private parseWhenConditions(when: string): Map<string, boolean> {
		const conditions = new Map<string, boolean>();
		const parts = when.split(/\s*&&\s*/);

		for (const part of parts) {
			const trimmed = part.trim();
			if (trimmed.startsWith('!')) {
				conditions.set(trimmed.substring(1), false);
			} else if (trimmed.includes('==')) {
				const [key, value] = trimmed.split('==').map(s => s.trim());
				conditions.set(key, value === 'true');
			} else {
				conditions.set(trimmed, true);
			}
		}

		return conditions;
	}

	/**
	 * Gets conflicts involving a specific keybinding
	 */
	getConflictsForBinding(
		binding: Keybinding,
		allConflicts: KeybindingConflict[]
	): KeybindingConflict[] {
		return allConflicts.filter(conflict =>
			conflict.bindings.some(b => b.id === binding.id)
		);
	}

	/**
	 * Gets all conflicting keys
	 */
	getConflictingKeys(conflicts: KeybindingConflict[]): Set<string> {
		return new Set(conflicts.map(c => normalizeKey(c.key)));
	}

	/**
	 * Checks if a specific key has conflicts
	 */
	hasConflict(key: string, conflicts: KeybindingConflict[]): boolean {
		const normalized = normalizeKey(key);
		return conflicts.some(c => normalizeKey(c.key) === normalized);
	}
}
