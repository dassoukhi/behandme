import type { NotificationDraft } from "./notification.js";

// French copy of every notification. Lock-screen text is the title and body: they must never hold a
// secret or a contract description (see push.ts).

/** `ownerName` trusts `userId`, who may now be chosen for their contracts. */
export function trustAdded(params: {
  userId: string;
  ownerId: string;
  ownerName: string | null;
}): NotificationDraft {
  const who = params.ownerName ?? "Quelqu'un";
  return {
    userId: params.userId,
    type: "trust_added",
    title: "Nouveau proche",
    body: `${who} vous a ajouté à ses proches.`,
    data: { url: `/people/${params.ownerId}` },
    critical: false,
  };
}
