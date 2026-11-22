import { FileText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { errorText } from "@/lib/core/error";
import { notifyError } from "@/lib/core/notify";
import { basenameOf } from "@/lib/core/path";
import { normalizePathKey } from "@/lib/vault/path";
import type { FileNode } from "@/lib/vault/types";
import { openPath } from "@/lib/workspace/navigation";
import { listPaperNoteDocuments } from "@/lib/workspace/paper-note-selection";

type PaperNoteSelectorProps = {
	vaultPath: string;
	notesPath: string;
	path: string;
	active: boolean;
};

export function PaperNoteSelector({
	vaultPath,
	notesPath,
	path,
	active,
}: PaperNoteSelectorProps) {
	const { t } = useTranslation("app");
	const [documents, setDocuments] = useState<FileNode[]>([]);
	const [switching, setSwitching] = useState(false);
	const request = useRef(0);

	const refresh = useCallback(async () => {
		const current = ++request.current;
		try {
			const next = await listPaperNoteDocuments(vaultPath, notesPath);
			if (request.current === current) setDocuments(next);
		} catch (error) {
			if (request.current === current) notifyError(errorText(error));
		}
	}, [vaultPath, notesPath]);

	useEffect(() => {
		if (!active) return;
		void refresh();
		return () => {
			request.current += 1;
		};
	}, [active, refresh]);

	const current = documents.find(
		(document) => normalizePathKey(document.path) === normalizePathKey(path),
	);
	const choices = current
		? documents
		: [
				{ id: path, name: basenameOf(path), path, kind: "file" as const },
				...documents,
			];

	const selectDocument = async (selected: string) => {
		if (normalizePathKey(selected) === normalizePathKey(path) || switching)
			return;
		setSwitching(true);
		const currentRequest = request.current;
		try {
			// The menu may have stayed open while another tool removed a document.
			const available = await listPaperNoteDocuments(vaultPath, notesPath);
			if (request.current !== currentRequest) return;
			const target = available.find(
				(document) =>
					normalizePathKey(document.path) === normalizePathKey(selected),
			);
			if (!target) {
				setDocuments(available);
				notifyError(t("paperNotes.missing", { name: basenameOf(selected) }));
				return;
			}
			openPath(target.path);
		} catch (error) {
			notifyError(errorText(error));
		} finally {
			setSwitching(false);
		}
	};

	return (
		<div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
			<FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			<Select
				value={current?.path ?? path}
				disabled={switching}
				onValueChange={(value) => void selectDocument(value)}
				onOpenChange={(open) => {
					if (open) void refresh();
				}}
			>
				<SelectTrigger
					size="sm"
					className="min-w-0 max-w-full"
					aria-label={t("paperNotes.document")}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{choices.map((document) => (
						<SelectItem key={document.path} value={document.path}>
							{document.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
