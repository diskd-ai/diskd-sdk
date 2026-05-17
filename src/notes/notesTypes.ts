// Project Notes domain types -- camelCase, readonly, no wire conversion needed.
// The app-service `/api/project-notes` REST API already returns camelCase.

// -- Domain models --

export type ProjectNoteParams = {
  readonly pin: boolean;
  readonly order: number;
};

export type ProjectNoteMetadata = {
  readonly agentId: string;
  readonly model: string;
  readonly provider: string;
};

export type ProjectNote = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly content: string;
  readonly prompt: string | null;
  readonly params: ProjectNoteParams;
  readonly metadata: ProjectNoteMetadata | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ProjectNoteHeader = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly contentPreview: string;
  readonly params: ProjectNoteParams;
  readonly createdAt: string;
  readonly updatedAt: string;
};

// -- Scope and params --

export type ProjectNotesScopeRef = {
  readonly scopeType: 'project';
  readonly projectId: string;
};

export type CreateProjectNoteParams = {
  readonly name: string;
  readonly content?: string;
  readonly prompt?: string | null;
  readonly metadata?: ProjectNoteMetadata | null;
  readonly params?: { readonly pin?: boolean; readonly order?: number };
};

// -- Client interface --

/**
 * Project-scoped Notes REST client.
 *
 * Obtain via `diskd.platform.notes({ auth, scope: { scopeType: 'project', projectId } })`.
 * Maps to app-service `/api/project-notes` endpoints and keeps project scope
 * bound at client construction time.
 */
export type ProjectNotesClient = {
  /** POST /api/project-notes -- create a Drive-backed project note. */
  readonly create: (params: CreateProjectNoteParams) => Promise<ProjectNote>;
  /** GET /api/project-notes/:noteId -- read a Drive-backed project note. */
  readonly read: (noteId: string) => Promise<ProjectNote>;
  /** GET /api/project-notes -- list Drive-backed project note headers. */
  readonly list: () => Promise<readonly ProjectNoteHeader[]>;
};
