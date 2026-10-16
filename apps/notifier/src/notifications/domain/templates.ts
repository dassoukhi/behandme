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

// Claims and release. Lock-screen text names the contract's category only, never its description.

const CATEGORY: Record<string, string> = {
  networks: "Réseaux sociaux",
  devices: "Appareils",
  storage: "Stockage en ligne",
};
const contractName = (category: string) =>
  `« ${CATEGORY[category] ?? "Contrat"} »`;

/** Someone says the owner can no longer act: the owner must be able to stop it at once. */
export function claimFiledForOwner(params: {
  ownerId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  return {
    userId: params.ownerId,
    type: "claim_filed_owner",
    title: "Demande de transmission",
    body: `Une transmission de votre contrat ${contractName(params.category)} a été demandée. Si vous êtes là, annulez-la dans l'app.`,
    data: { url: `/contract/${params.contractId}` },
    critical: true,
  };
}

export function claimFiledForValidator(params: {
  validatorId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  return {
    userId: params.validatorId,
    type: "claim_filed_validator",
    title: "Votre avis est demandé",
    body: `Une transmission du contrat ${contractName(params.category)} a été demandée : approuvez-la ou refusez-la.`,
    data: { url: `/contract/${params.contractId}` },
    critical: false,
  };
}

/** Enough validators approved: the owner has until the end of the window to stop it. */
export function claimQuorumReached(params: {
  ownerId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  return {
    userId: params.ownerId,
    type: "claim_quorum_reached",
    title: "Transmission imminente",
    body: `Assez de validateurs ont approuvé la transmission de ${contractName(params.category)}. Si vous êtes là, annulez-la avant la fin du délai.`,
    data: { url: `/contract/${params.contractId}` },
    critical: true,
  };
}

const CLOSED: Record<string, string> = {
  cancelled: "Le propriétaire a annulé la demande de transmission",
  withdrawn: "La demande de transmission a été retirée",
  rejected: "Les validateurs ont refusé la demande de transmission",
  expired: "La demande de transmission a expiré",
  revoked: "Le propriétaire a révoqué le contrat",
};

export function claimClosed(params: {
  userId: string;
  contractId: string;
  category: string;
  reason: string;
}): NotificationDraft {
  return {
    userId: params.userId,
    type: "claim_closed",
    title: "Demande close",
    body: `${CLOSED[params.reason] ?? "La demande de transmission est close"} (${contractName(params.category)}).`,
    data: { url: `/contract/${params.contractId}` },
    critical: false,
  };
}

/** The accessor may now open what was entrusted to them. */
export function contractReleasedForAccessor(params: {
  accessorId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  return {
    userId: params.accessorId,
    type: "contract_released",
    title: "Accès transmis",
    body: `Le contrat ${contractName(params.category)} vous a été transmis : vous pouvez l'ouvrir dans l'app.`,
    data: { url: `/contract/${params.contractId}` },
    critical: true,
  };
}

/** A day before the end of the contest window: the owner's last chance to say they are there. */
export function claimReminderForOwner(params: {
  ownerId: string;
  contractId: string;
  category: string;
  quorum: boolean;
}): NotificationDraft {
  return {
    userId: params.ownerId,
    type: "claim_reminder_owner",
    title: "Dernier rappel",
    body: params.quorum
      ? `La transmission de ${contractName(params.category)} a lieu à la fin du délai, bientôt. Si vous êtes là, annulez-la maintenant.`
      : `Une transmission de ${contractName(params.category)} est toujours demandée. Si vous êtes là, annulez-la maintenant.`,
    data: { url: `/contract/${params.contractId}` },
    critical: true,
  };
}

export function claimReminderForValidator(params: {
  validatorId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  return {
    userId: params.validatorId,
    type: "claim_reminder_validator",
    title: "Votre avis est attendu",
    body: `La transmission de ${contractName(params.category)} attend toujours votre décision.`,
    data: { url: `/contract/${params.contractId}` },
    critical: false,
  };
}
