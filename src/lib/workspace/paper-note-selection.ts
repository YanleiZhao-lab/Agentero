import { normalizePath } from "@/lib/core/path";
import {
	readJsonStorage,
	removeStorageKey,
	writeJsonStorage,
} from "@/lib/core/storage";
import { isPaperChildDocName, isPaperChildDocPath } from "@/lib/paper/children";
import {
	isValidVaultEntryName,
	joinVaultPath,
	normalizePathKey,
} from "@/lib/vault/path";
import { listVaultDirChildren } from "@/lib/vault/tree";
import type { FileNode } from "@/lib/vault/types";

function paperDirectory(notesPath: string): string {
	return normalizePath(notesPath).replace(/\/notes\.md$/i, "");
}

function selectionKey(vaultPath: string, notesPath: string): string {
	return `agentero.paperNoteSelection::${normalizePathKey(vaultPath)}::${normalizePathKey(paperDirectory(notesPath))}`;
}

export function isPaperRootNoteDocument(
	path: string,
	notesPath: string,
): boolean {
	return isPaperChildDocPath(path, paperDirectory(notesPath));
}

/** Read the paper root independently of whether its sidebar row is expanded. */
export async function listPaperNoteDocuments(
	vaultPath: string,
	notesPath: string,
): Promise<FileNode[]> {
	const directory = paperDirectory(notesPath);
	const children = await listVaultDirChildren(vaultPath, directory);
	const documents = children.filter(
		(child) =>
			child.kind === "file" && isPaperRootNoteDocument(child.path, notesPath),
	);
	if (
		!documents.some(
			(child) => normalizePathKey(child.path) === normalizePathKey(notesPath),
		)
	) {
		documents.unshift({
			id: notesPath,
			name: "NOTES.md",
			path: notesPath,
			kind: "file",
		});
	}
	return documents.sort((left, right) => {
		if (normalizePathKey(left.path) === normalizePathKey(notesPath)) return -1;
		if (normalizePathKey(right.path) === normalizePathKey(notesPath)) return 1;
		return left.name.localeCompare(right.name, undefined, { numeric: true });
	});
}

/** Store only a direct child name; never let stored data choose an arbitrary path. */
export function rememberPaperNoteDocument(
	vaultPath: string,
	notesPath: string,
	path: string,
): void {
	if (!isPaperRootNoteDocument(path, notesPath)) return;
	if (normalizePathKey(path) === normalizePathKey(notesPath)) {
		removeStorageKey(selectionKey(vaultPath, notesPath));
		return;
	}
	const name = normalizePath(path).split("/").at(-1);
	writeJsonStorage(selectionKey(vaultPath, notesPath), name);
}

export function storedPaperNoteDocument(
	vaultPath: string,
	notesPath: string,
): string {
	const key = selectionKey(vaultPath, notesPath);
	const name = readJsonStorage<unknown>(key, null);
	if (name === null) return notesPath;
	if (
		typeof name !== "string" ||
		!isValidVaultEntryName(name) ||
		!isPaperChildDocName(name)
	) {
		removeStorageKey(key);
		return notesPath;
	}
	return joinVaultPath(paperDirectory(notesPath), name);
}

/** NOTES remains the default; a removed selection is forgotten, never recreated. */
export async function preferredPaperNoteDocument(
	vaultPath: string,
	notesPath: string,
): Promise<string> {
	const selectedPath = storedPaperNoteDocument(vaultPath, notesPath);
	if (normalizePathKey(selectedPath) === normalizePathKey(notesPath)) {
		return notesPath;
	}
	const documents = await listPaperNoteDocuments(vaultPath, notesPath);
	const selected = documents.find(
		(document) =>
			normalizePathKey(document.path) === normalizePathKey(selectedPath),
	);
	if (selected) return selected.path;
	removeStorageKey(selectionKey(vaultPath, notesPath));
	return notesPath;
}
