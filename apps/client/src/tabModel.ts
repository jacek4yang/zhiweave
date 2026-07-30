export interface TabSession {
  readonly openNoteIds: readonly string[];
  readonly closedNoteIds: readonly string[];
  readonly previewNoteId: string | null;
}

export interface ReopenedTab {
  readonly session: TabSession;
  readonly noteId: string | null;
}

const CLOSED_TAB_LIMIT = 20;

export function createTabSession(selectedNoteId: string | null): TabSession {
  return {
    openNoteIds:
      selectedNoteId === null || selectedNoteId.length === 0
        ? []
        : [selectedNoteId],
    closedNoteIds: [],
    previewNoteId: null,
  };
}

export function openPreviewTab(
  session: TabSession,
  noteId: string,
): TabSession {
  if (session.openNoteIds.includes(noteId)) {
    return removeFromClosed(session, noteId);
  }

  const previewIndex =
    session.previewNoteId === null
      ? -1
      : session.openNoteIds.indexOf(session.previewNoteId);
  const openNoteIds =
    previewIndex < 0
      ? [...session.openNoteIds, noteId]
      : session.openNoteIds.map((id, index) =>
          index === previewIndex ? noteId : id,
        );

  return {
    openNoteIds,
    closedNoteIds: session.closedNoteIds.filter((id) => id !== noteId),
    previewNoteId: noteId,
  };
}

export function openPinnedTab(
  session: TabSession,
  noteId: string,
): TabSession {
  return {
    openNoteIds: session.openNoteIds.includes(noteId)
      ? session.openNoteIds
      : [...session.openNoteIds, noteId],
    closedNoteIds: session.closedNoteIds.filter((id) => id !== noteId),
    previewNoteId:
      session.previewNoteId === noteId ? null : session.previewNoteId,
  };
}

export function pinTab(session: TabSession, noteId: string): TabSession {
  if (
    session.previewNoteId !== noteId ||
    !session.openNoteIds.includes(noteId)
  ) {
    return session;
  }
  return {
    ...session,
    previewNoteId: null,
  };
}

export function makeTabPreview(
  session: TabSession,
  noteId: string,
): TabSession {
  if (!session.openNoteIds.includes(noteId)) {
    return session;
  }
  return {
    openNoteIds: session.openNoteIds.filter(
      (id) => id !== session.previewNoteId || id === noteId,
    ),
    closedNoteIds: session.closedNoteIds,
    previewNoteId: noteId,
  };
}

export function closeTabInSession(
  session: TabSession,
  noteId: string,
): TabSession {
  if (!session.openNoteIds.includes(noteId)) {
    return session;
  }
  return {
    openNoteIds: session.openNoteIds.filter((id) => id !== noteId),
    closedNoteIds: pushClosed(session.closedNoteIds, [noteId]),
    previewNoteId:
      session.previewNoteId === noteId ? null : session.previewNoteId,
  };
}

export function closeOtherTabsInSession(
  session: TabSession,
  noteId: string,
): TabSession {
  if (!session.openNoteIds.includes(noteId)) {
    return openPinnedTab(session, noteId);
  }
  return {
    openNoteIds: [noteId],
    closedNoteIds: pushClosed(
      session.closedNoteIds,
      session.openNoteIds.filter((id) => id !== noteId),
    ),
    previewNoteId: null,
  };
}

export function reopenClosedTabInSession(
  session: TabSession,
  validNoteIds: ReadonlySet<string>,
): ReopenedTab {
  const noteId =
    session.closedNoteIds.find((id) => validNoteIds.has(id)) ?? null;
  const closedNoteIds = session.closedNoteIds.filter(
    (id) => validNoteIds.has(id) && id !== noteId,
  );
  if (noteId === null) {
    return {
      session: {
        ...session,
        closedNoteIds,
      },
      noteId: null,
    };
  }
  return {
    session: openPinnedTab(
      {
        ...session,
        closedNoteIds,
      },
      noteId,
    ),
    noteId,
  };
}

export function reconcileTabSession(
  session: TabSession,
  validNoteIds: ReadonlySet<string>,
  ensureOpenNoteId: string | null,
): TabSession {
  const openNoteIds = unique(
    session.openNoteIds.filter((id) => validNoteIds.has(id)),
  );
  if (
    ensureOpenNoteId !== null &&
    validNoteIds.has(ensureOpenNoteId) &&
    !openNoteIds.includes(ensureOpenNoteId)
  ) {
    openNoteIds.push(ensureOpenNoteId);
  }
  const openSet = new Set(openNoteIds);
  const closedNoteIds = unique(
    session.closedNoteIds.filter(
      (id) => validNoteIds.has(id) && !openSet.has(id),
    ),
  ).slice(0, CLOSED_TAB_LIMIT);
  return {
    openNoteIds,
    closedNoteIds,
    previewNoteId:
      session.previewNoteId !== null &&
      openSet.has(session.previewNoteId)
        ? session.previewNoteId
        : null,
  };
}

export function remapTabSession(
  session: TabSession,
  resolveNoteId: (noteId: string) => string | null,
  validNoteIds: ReadonlySet<string>,
  ensureOpenNoteId: string | null,
): TabSession {
  const previewNoteId =
    session.previewNoteId === null
      ? null
      : resolveNoteId(session.previewNoteId);
  return reconcileTabSession(
    {
      openNoteIds: session.openNoteIds.flatMap((id) => {
        const resolved = resolveNoteId(id);
        return resolved === null ? [] : [resolved];
      }),
      closedNoteIds: session.closedNoteIds.flatMap((id) => {
        const resolved = resolveNoteId(id);
        return resolved === null ? [] : [resolved];
      }),
      previewNoteId,
    },
    validNoteIds,
    ensureOpenNoteId,
  );
}

function removeFromClosed(session: TabSession, noteId: string): TabSession {
  if (!session.closedNoteIds.includes(noteId)) {
    return session;
  }
  return {
    ...session,
    closedNoteIds: session.closedNoteIds.filter((id) => id !== noteId),
  };
}

function pushClosed(
  current: readonly string[],
  next: readonly string[],
): readonly string[] {
  const nextSet = new Set(next);
  return [
    ...unique(next),
    ...current.filter((id) => !nextSet.has(id)),
  ].slice(0, CLOSED_TAB_LIMIT);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
