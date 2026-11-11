import type { Language, NotificationDraft } from "./notification.js";

// The copy of every notification, in each language of the app. Lock-screen text is the title and
// body: they must never hold a secret or a contract description (see push.ts).

/** `ownerName` trusts `userId`, who may now be chosen for their contracts. */
export function trustAdded(params: {
  userId: string;
  ownerId: string;
  ownerName: string | null;
}): NotificationDraft {
  return {
    userId: params.userId,
    type: "trust_added",
    copy: {
      fr: {
        title: "Nouveau proche",
        body: `${params.ownerName ?? "Quelqu'un"} vous a ajouté à ses proches.`,
      },
      en: {
        title: "New trusted contact",
        body: `${params.ownerName ?? "Someone"} added you as a trusted contact.`,
      },
    },
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
    copy: {
      fr: {
        title: "Vos clés ont été réinitialisées",
        body: "Si ce n'est pas vous, changez votre mot de passe tout de suite et prévenez vos proches.",
      },
      en: {
        title: "Your keys were reset",
        body: "If this wasn't you, change your password right away and warn your trusted contacts.",
      },
    },
    data: { url: "/settings/security" },
    critical: true,
  };
}

/** Keys that reached a phone: pushed even when push is off, since it may not have been the user. */
function keysReachedAPhone(
  userId: string,
  type: string,
  title: { fr: string; en: string },
): NotificationDraft {
  return {
    userId,
    type,
    copy: {
      fr: {
        title: title.fr,
        body: "Si ce n'est pas vous, réinitialisez vos clés et changez votre mot de passe tout de suite.",
      },
      en: {
        title: title.en,
        body: "If this wasn't you, reset your keys and change your password right away.",
      },
    },
    data: { url: "/settings/security" },
    critical: true,
  };
}

/** A new phone took the user's keys from their old one: if it was not them, someone holds their session and a phone of theirs. */
export function keysTransferred(params: { userId: string }): NotificationDraft {
  return keysReachedAPhone(params.userId, "keys_transferred", {
    fr: "Vos clés sont sur un nouveau téléphone",
    en: "Your keys are on a new phone",
  });
}

/**
 * A phone took the user's keys from their passkey backup, after a fresh verification: if it was not them, someone
 * holds their password and their passkey.
 */
export function keysBackupOpened(params: {
  userId: string;
}): NotificationDraft {
  return keysReachedAPhone(params.userId, "keys_backup_opened", {
    fr: "Vos clés ont été récupérées avec votre clé d'accès",
    en: "Your keys were recovered with your passkey",
  });
}

/** Someone the reader trusts has new keys: compare their new security code before entrusting them. */
export function contactKeysReset(params: {
  trusterId: string;
  userId: string;
  userName: string | null;
}): NotificationDraft {
  return {
    userId: params.trusterId,
    type: "contact_keys_reset",
    copy: {
      fr: {
        title: "Clés réinitialisées",
        body: `${params.userName ?? "Un de vos proches"} a réinitialisé ses clés. Comparez son nouveau code de sécurité avant de lui confier un accès.`,
      },
      en: {
        title: "Keys reset",
        body: `${params.userName ?? "One of your trusted contacts"} reset their keys. Compare their new security code before entrusting them with access.`,
      },
    },
    data: { url: `/people/${params.userId}` },
    critical: false,
  };
}

/** Time to check the recovery phrase. Nothing on the lock screen says where the user keeps it. */
export function phraseCheck(params: { userId: string }): NotificationDraft {
  return {
    userId: params.userId,
    type: "phrase_check",
    copy: {
      fr: {
        title: "Votre phrase est-elle toujours à sa place ?",
        body: "Une minute pour le vérifier, tant que ce téléphone a vos clés.",
      },
      en: {
        title: "Is your recovery phrase still in its place?",
        body: "Take a minute to check, while this phone still has your keys.",
      },
    },
    data: { url: "/keys/check" },
    critical: false,
  };
}

/** Once a year: opening the app is all it takes, and tells those who rely on this user that all is well. */
export function keyCheckup(params: { userId: string }): NotificationDraft {
  return {
    userId: params.userId,
    type: "key_checkup",
    copy: {
      fr: {
        title: "Votre point annuel",
        body: "Ouvrez BehyndMe une minute : vos proches comptent sur vous.",
      },
      en: {
        title: "Your yearly check-up",
        body: "Open BehyndMe for a minute: the people close to you are counting on you.",
      },
    },
    data: { url: "/" },
    critical: false,
  };
}

// Claims and release. Lock-screen text names the contract's category only, never its description.

const CATEGORY: Record<Language, Record<string, string>> = {
  fr: {
    networks: "Réseaux sociaux",
    devices: "Appareils",
    storage: "Stockage en ligne",
  },
  en: {
    networks: "Social media",
    devices: "Devices",
    storage: "Online storage",
  },
};
const contractName = (category: string) => ({
  fr: `« ${CATEGORY.fr[category] ?? "Contrat"} »`,
  en: `“${CATEGORY.en[category] ?? "Contract"}”`,
});

/** Someone says the owner can no longer act: the owner must be able to stop it at once. */
export function claimFiledForOwner(params: {
  ownerId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.ownerId,
    type: "claim_filed_owner",
    copy: {
      fr: {
        title: "Demande de transmission",
        body: `Une transmission de votre contrat ${name.fr} a été demandée. Si vous êtes là, annulez-la dans l'app.`,
      },
      en: {
        title: "Handover request",
        body: `A handover of your contract ${name.en} was requested. If you're still here, cancel it in the app.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: true,
  };
}

/**
 * Someone now holds a share of a contract: they should know, and keep their keys. Category only; it opens
 * the screen where they keep their keys, the one thing to do.
 */
export function chosenAsValidator(params: {
  validatorId: string;
  category: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.validatorId,
    type: "validator_chosen",
    copy: {
      fr: {
        title: "Un proche compte sur vous",
        body: `Vous êtes validateur du contrat ${name.fr}. Gardez vos clés à l'abri : une minute suffit.`,
      },
      en: {
        title: "Someone close is counting on you",
        body: `You are a validator of the contract ${name.en}. Keep your keys safe: it takes a minute.`,
      },
    },
    data: { url: "/keys" },
    critical: false,
  };
}

export function claimFiledForValidator(params: {
  validatorId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.validatorId,
    type: "claim_filed_validator",
    copy: {
      fr: {
        title: "Votre avis est demandé",
        body: `Une transmission du contrat ${name.fr} a été demandée : approuvez-la ou refusez-la.`,
      },
      en: {
        title: "Your decision is needed",
        body: `A handover of the contract ${name.en} was requested: approve or refuse it.`,
      },
    },
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
  const name = contractName(params.category);
  return {
    userId: params.ownerId,
    type: "claim_quorum_reached",
    copy: {
      fr: {
        title: "Transmission imminente",
        body: `Assez de validateurs ont approuvé la transmission de ${name.fr}. Si vous êtes là, annulez-la avant la fin du délai.`,
      },
      en: {
        title: "Handover coming soon",
        body: `Enough validators approved the handover of ${name.en}. If you're still here, cancel it before the waiting period ends.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: true,
  };
}

const CLOSED: Record<Language, Record<string, string>> = {
  fr: {
    cancelled: "Le propriétaire a annulé la demande de transmission",
    withdrawn: "La demande de transmission a été retirée",
    rejected: "Les validateurs ont refusé la demande de transmission",
    expired: "La demande de transmission a expiré",
    revoked: "Le propriétaire a révoqué le contrat",
    participant_left:
      "Un participant a supprimé son compte : la demande de transmission est close",
  },
  en: {
    cancelled: "The owner cancelled the handover request",
    withdrawn: "The handover request was withdrawn",
    rejected: "The validators refused the handover request",
    expired: "The handover request expired",
    revoked: "The owner revoked the contract",
    participant_left:
      "A participant deleted their account: the handover request is closed",
  },
};

export function claimClosed(params: {
  userId: string;
  contractId: string;
  category: string;
  reason: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.userId,
    type: "claim_closed",
    copy: {
      fr: {
        title: "Demande close",
        body: `${CLOSED.fr[params.reason] ?? "La demande de transmission est close"} (${name.fr}).`,
      },
      en: {
        title: "Request closed",
        body: `${CLOSED.en[params.reason] ?? "The handover request is closed"} (${name.en}).`,
      },
    },
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
  const name = contractName(params.category);
  return {
    userId: params.accessorId,
    type: "contract_released",
    copy: {
      fr: {
        title: "Accès transmis",
        body: `Le contrat ${name.fr} vous a été transmis : vous pouvez l'ouvrir dans l'app.`,
      },
      en: {
        title: "Access handed over",
        body: `The contract ${name.en} has been handed over to you: you can open it in the app.`,
      },
    },
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
  const name = contractName(params.category);
  return {
    userId: params.ownerId,
    type: "claim_reminder_owner",
    copy: {
      fr: {
        title: "Dernier rappel",
        body: params.quorum
          ? `La transmission de ${name.fr} a lieu à la fin du délai, bientôt. Si vous êtes là, annulez-la maintenant.`
          : `Une transmission de ${name.fr} est toujours demandée. Si vous êtes là, annulez-la maintenant.`,
      },
      en: {
        title: "Last reminder",
        body: params.quorum
          ? `The handover of ${name.en} will take place soon, at the end of the waiting period. If you're still here, cancel it now.`
          : `A handover of ${name.en} is still requested. If you're still here, cancel it now.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: true,
  };
}

export function claimReminderForValidator(params: {
  validatorId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.validatorId,
    type: "claim_reminder_validator",
    copy: {
      fr: {
        title: "Votre avis est attendu",
        body: `La transmission de ${name.fr} attend toujours votre décision.`,
      },
      en: {
        title: "Your decision is awaited",
        body: `The handover of ${name.en} is still waiting for your decision.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: false,
  };
}

/** Nobody can open the contract any more: its accessor and validators are told why. */
export function contractRevoked(params: {
  userId: string;
  contractId: string;
  category: string;
  reason: string;
}): NotificationDraft {
  const name = contractName(params.category);
  const ownerLeft = params.reason === "account_deleted";
  return {
    userId: params.userId,
    type: "contract_revoked",
    copy: {
      fr: {
        title: "Contrat révoqué",
        body: ownerLeft
          ? `Le propriétaire a supprimé son compte : le contrat ${name.fr} est révoqué.`
          : `Le propriétaire a révoqué le contrat ${name.fr}.`,
      },
      en: {
        title: "Contract revoked",
        body: ownerLeft
          ? `The owner deleted their account: the contract ${name.en} is revoked.`
          : `The owner revoked the contract ${name.en}.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: false,
  };
}

/** A participant deleted their account: the owner should choose someone else and re-seal. */
export function participantLeft(params: {
  ownerId: string;
  contractId: string;
  category: string;
  role: string;
}): NotificationDraft {
  const name = contractName(params.category);
  const accessor = params.role === "accessor";
  return {
    userId: params.ownerId,
    type: "participant_left",
    copy: {
      fr: {
        title: accessor ? "Accesseur parti" : "Validateur parti",
        body: accessor
          ? `L'accesseur de votre contrat ${name.fr} a supprimé son compte : choisissez-en un autre et scellez à nouveau.`
          : `Un validateur de votre contrat ${name.fr} a supprimé son compte : sa part est perdue. Scellez à nouveau pour en choisir un autre.`,
      },
      en: {
        title: accessor ? "Recipient left" : "Validator left",
        body: accessor
          ? `The recipient of your contract ${name.en} deleted their account: choose another one and seal again.`
          : `A validator of your contract ${name.en} deleted their account: their share is lost. Seal again to choose another one.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: false,
  };
}
