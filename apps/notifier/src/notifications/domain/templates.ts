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

/**
 * The user's end-to-end keys were reset. If it was not them, someone holds their session: pushed even
 * when push is off, while the quarantine still protects their contacts.
 */
export function keysReset(params: { userId: string }): NotificationDraft {
  return {
    userId: params.userId,
    type: "keys_reset",
    title: "Vos clés ont été réinitialisées",
    body: "Si ce n'est pas vous, changez votre mot de passe tout de suite et prévenez vos proches.",
    data: { url: "/settings/security" },
    critical: true,
  };
}

/** Someone the reader trusts has new keys: compare their new security code before entrusting them. */
export function contactKeysReset(params: {
  trusterId: string;
  userId: string;
  userName: string | null;
}): NotificationDraft {
  const who = params.userName ?? "Un de vos proches";
  return {
    userId: params.trusterId,
    type: "contact_keys_reset",
    title: "Clés réinitialisées",
    body: `${who} a réinitialisé ses clés. Comparez son nouveau code de sécurité avant de lui confier un accès.`,
    data: { url: `/people/${params.userId}` },
    critical: false,
  };
}
