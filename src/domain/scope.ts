import { normalizeProject } from "~/domain/memory";

type ScopedDocument = {
  project: string;
  namespace?: string | null;
};

export function isVisibleInProjectScope(document: ScopedDocument, project?: string) {
  const normalizedProject = normalizeProject(project);
  const documentProject = normalizeProject(document.project);
  const namespace = document.namespace ? normalizeProject(document.namespace) : documentProject;

  if (normalizedProject === "shared") {
    return documentProject === "shared" || namespace === "shared";
  }

  return documentProject === normalizedProject || namespace === normalizedProject || documentProject === "shared";
}
