import type { EmailContext, EmailFact } from "./email.js";
import type { Language, NotificationDraft } from "./notification.js";

// The copy of every notification, in each language of the app. Lock-screen text is the title and
// body: they must never hold a secret or a contract description (see push.ts). The e-mail (`email`)
// says more: who acted and until when the recipient can react, never more than the app shows them. It
// names only the users listed in `mentions`, from the notifier's copy of their profile (safeName).

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
    mentions: [params.ownerId],
    email: (ctx) => {
      const owner = ctx.name(params.ownerId);
      const first = ctx.firstName(params.ownerId);
      return {
        fr: {
          subject: owner ? `${owner} vous a ajouté à ses proches` : undefined,
          paragraphs: [
            `${owner ?? "Quelqu'un"} vous a ajouté à ses proches sur BehyndMe.`,
            `${first ?? "Cette personne"} peut désormais vous confier un accès, ou vous demander de valider sa transmission, pour le jour où il lui sera impossible d'agir.`,
            `Vous retrouverez ${first ?? "cette personne"} dans l'app, onglet Proches, sous « Ils me font confiance ».`,
          ],
        },
        en: {
          subject: owner
            ? `${owner} added you as a trusted contact`
            : undefined,
          paragraphs: [
            `${owner ?? "Someone"} added you as a trusted contact on BehyndMe.`,
            `${first ?? "They"} can now entrust you with an access, or ask you to validate its handover, for the day they can no longer act.`,
            `You will find ${first ?? "them"} in the app, in the Contacts tab, under “They trust me”.`,
          ],
        },
      };
    },
  };
}

/**
 * The user's end-to-end keys were reset. If it was not them, someone holds their session: pushed even
 * when push is off, while the quarantine still protects their contacts.
 */
export function keysReset(params: {
  userId: string;
  usableFrom: string;
}): NotificationDraft {
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
    email: (ctx) => {
      const usable = ctx.at(params.usableFrom);
      return {
        fr: {
          paragraphs: [
            `Les clés de chiffrement de votre compte BehyndMe ont été réinitialisées le ${ctx.occurred.fr}.`,
            `Si c'est vous, tout est en ordre. Par sécurité, vos nouvelles clés ne serviront à sceller un contrat qu'à partir du ${usable.fr}.`,
            "Si ce n'est pas vous, quelqu'un a accès à votre compte : changez votre mot de passe tout de suite, puis prévenez vos proches.",
          ],
          facts: [
            { label: "Réinitialisées le", value: ctx.occurred.fr },
            { label: "Scellement possible à partir du", value: usable.fr },
          ],
        },
        en: {
          paragraphs: [
            `The encryption keys of your BehyndMe account were reset on ${ctx.occurred.en}.`,
            `If it was you, all is well. For security, your new keys can only be used to seal a contract from ${usable.en}.`,
            "If it wasn't you, someone has access to your account: change your password right away, then warn your trusted contacts.",
          ],
          facts: [
            { label: "Reset on", value: ctx.occurred.en },
            { label: "Sealing possible from", value: usable.en },
          ],
        },
      };
    },
  };
}

/** Keys that reached a phone: pushed even when push is off, since it may not have been the user. */
function keysReachedAPhone(
  userId: string,
  type: string,
  title: { fr: string; en: string },
  happened: (ctx: EmailContext) => { fr: string; en: string },
  ifNotYou: { fr: string; en: string },
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
    email: (ctx) => ({
      fr: {
        paragraphs: [
          happened(ctx).fr,
          "Si c'est vous, vous n'avez rien à faire.",
          `Si ce n'est pas vous, ${ifNotYou.fr} : réinitialisez vos clés et changez votre mot de passe tout de suite, dans l'app, Réglages › Sécurité.`,
        ],
      },
      en: {
        paragraphs: [
          happened(ctx).en,
          "If it was you, there is nothing to do.",
          `If it wasn't you, ${ifNotYou.en}: reset your keys and change your password right away, in the app under Settings › Security.`,
        ],
      },
    }),
  };
}

/** A new phone took the user's keys from their old one: if it was not them, someone holds their session and a phone of theirs. */
export function keysTransferred(params: { userId: string }): NotificationDraft {
  return keysReachedAPhone(
    params.userId,
    "keys_transferred",
    {
      fr: "Vos clés sont sur un nouveau téléphone",
      en: "Your keys are on a new phone",
    },
    (ctx) => ({
      fr: `Vos clés BehyndMe ont été copiées sur un nouveau téléphone le ${ctx.occurred.fr}.`,
      en: `Your BehyndMe keys were copied to a new phone on ${ctx.occurred.en}.`,
    }),
    {
      fr: "quelqu'un a accès à votre compte et à l'un de vos téléphones",
      en: "someone has access to your account and to one of your phones",
    },
  );
}

/**
 * A phone took the user's keys from their passkey backup, after a fresh verification: if it was not them, someone
 * holds their password and their passkey.
 */
export function keysBackupOpened(params: {
  userId: string;
}): NotificationDraft {
  return keysReachedAPhone(
    params.userId,
    "keys_backup_opened",
    {
      fr: "Vos clés ont été récupérées avec votre clé d'accès",
      en: "Your keys were recovered with your passkey",
    },
    (ctx) => ({
      fr: `Vos clés ont été récupérées avec votre clé d'accès (passkey) le ${ctx.occurred.fr}, après une nouvelle vérification de votre compte.`,
      en: `Your keys were recovered with your passkey on ${ctx.occurred.en}, after your account was verified again.`,
    }),
    {
      fr: "quelqu'un connaît votre mot de passe et peut utiliser votre clé d'accès",
      en: "someone knows your password and can use your passkey",
    },
  );
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
    mentions: [params.userId],
    email: (ctx) => {
      const name = ctx.name(params.userId);
      const first = ctx.firstName(params.userId);
      return {
        fr: {
          subject: name ? `${name} a réinitialisé ses clés` : undefined,
          paragraphs: [
            `${name ?? "Un de vos proches"} a réinitialisé ses clés de chiffrement le ${ctx.occurred.fr}.`,
            `Avant de lui confier un nouvel accès, comparez son nouveau code de sécurité avec ${first ?? "cette personne"}, de vive voix ou en personne, jamais par message. Vous le trouverez sur sa fiche, dans l'onglet Proches.`,
            `Si ${first ?? "cette personne"} ne vous en a pas parlé, demandez-lui confirmation par un autre moyen que BehyndMe.`,
          ],
        },
        en: {
          subject: name ? `${name} reset their keys` : undefined,
          paragraphs: [
            `${name ?? "One of your trusted contacts"} reset their encryption keys on ${ctx.occurred.en}.`,
            `Before entrusting them with a new access, compare their new security code with ${first ?? "them"}, out loud or in person, never by message. You will find it on their page, in the Contacts tab.`,
            `If ${first ?? "they"} did not mention it, ask them to confirm by some other means than BehyndMe.`,
          ],
        },
      };
    },
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
    // Where the user keeps the phrase stays out of the e-mail too: a mailbox can be read by others.
    email: () => ({
      fr: {
        paragraphs: [
          "C'est le moment de vérifier votre phrase de récupération : est-elle toujours à l'endroit où vous l'avez rangée ?",
          "Dans l'app, BehyndMe vous demande trois de ses mots : une minute suffit. Faites-le tant que ce téléphone a encore vos clés : le jour où vous le perdrez, c'est cette phrase qui les fera revenir.",
        ],
      },
      en: {
        paragraphs: [
          "Time to check your recovery phrase: is it still where you put it?",
          "In the app, BehyndMe asks you for three of its words: it takes a minute. Do it while this phone still has your keys: the day you lose it, this phrase is what brings them back.",
        ],
      },
    }),
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
    email: () => ({
      fr: {
        paragraphs: [
          "Votre point annuel BehyndMe est arrivé.",
          "Ouvrir l'app une minute suffit : elle vérifie que vos clés sont toujours là, et le confirme aux proches qui comptent sur vous.",
          "Profitez-en pour relire vos contrats et les personnes qu'ils désignent.",
        ],
      },
      en: {
        paragraphs: [
          "Your yearly BehyndMe check-up is due.",
          "Opening the app for a minute is enough: it checks that your keys are still there, and lets the people who count on you know.",
          "Take the chance to review your contracts and the people they name.",
        ],
      },
    }),
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
const categoryLabel = (category: string) => ({
  fr: CATEGORY.fr[category] ?? "Contrat",
  en: CATEGORY.en[category] ?? "Contract",
});
const contractName = (category: string) => ({
  fr: `« ${categoryLabel(category).fr} »`,
  en: `“${categoryLabel(category).en}”`,
});

/** "Camille Martin's", or "the" when the owner is unknown: "Camille Martin's contract “Devices”". */
const possessive = (name: string | null) => (name ? `${name}'s` : "the");

/** Someone says the owner can no longer act: the owner must be able to stop it at once. */
export function claimFiledForOwner(params: {
  ownerId: string;
  contractId: string;
  category: string;
  claimantId: string;
  contestUntil: string;
}): NotificationDraft {
  const name = contractName(params.category);
  const label = categoryLabel(params.category);
  return {
    userId: params.ownerId,
    type: "claim_filed_owner",
    mentions: [params.claimantId],
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
    email: (ctx) => {
      const claimant = ctx.name(params.claimantId);
      const until = ctx.at(params.contestUntil);
      const requestedBy = (label: string): EmailFact[] =>
        claimant ? [{ label, value: claimant }] : [];
      return {
        fr: {
          subject: `Demande de transmission : ${name.fr}`,
          paragraphs: [
            `${claimant ?? "Quelqu'un"} a demandé la transmission de votre contrat ${name.fr}, le ${ctx.occurred.fr}.`,
            "Si vous êtes là, annulez la demande dans l'app : rien ne sera transmis.",
            `Sinon, l'accès sera transmis à partir du ${until.fr}, dès que vos validateurs auront approuvé la demande.`,
          ],
          facts: [
            { label: "Contrat", value: label.fr },
            ...requestedBy("Demandée par"),
            { label: "Annulation possible jusqu'au", value: until.fr },
          ],
        },
        en: {
          subject: `Handover request: ${name.en}`,
          paragraphs: [
            `${claimant ?? "Someone"} requested the handover of your contract ${name.en} on ${ctx.occurred.en}.`,
            "If you're still here, cancel the request in the app: nothing will be handed over.",
            `Otherwise, access will be handed over from ${until.en}, as soon as your validators have approved the request.`,
          ],
          facts: [
            { label: "Contract", value: label.en },
            ...requestedBy("Requested by"),
            { label: "Can be cancelled until", value: until.en },
          ],
        },
      };
    },
  };
}

/**
 * Someone now holds a share of a contract: they should know, and keep their keys. Category only; it opens
 * the screen where they keep their keys, the one thing to do.
 */
export function chosenAsValidator(params: {
  validatorId: string;
  ownerId: string;
  category: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.validatorId,
    type: "validator_chosen",
    mentions: [params.ownerId],
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
    email: (ctx) => {
      const owner = ctx.name(params.ownerId);
      const first = ctx.firstName(params.ownerId);
      return {
        fr: {
          subject: owner ? `${owner} compte sur vous` : undefined,
          paragraphs: [
            `${owner ?? "Un proche"} vous a choisi comme validateur de son contrat ${name.fr}.`,
            `Le jour où quelqu'un demandera sa transmission, votre avis sera demandé : vous ne l'approuverez que si vous êtes sûr que ${first ?? "cette personne"} ne peut plus agir.`,
            "D'ici là, gardez vos clés à l'abri : sans elles, vous ne pourrez pas approuver. L'app vous guide, une minute suffit.",
          ],
        },
        en: {
          subject: owner ? `${owner} is counting on you` : undefined,
          paragraphs: [
            `${owner ?? "Someone close to you"} chose you as a validator of their contract ${name.en}.`,
            `The day someone requests its handover, you will be asked for your decision: only approve it if you are sure ${first ?? "they"} can no longer act.`,
            "Until then, keep your keys safe: without them, you cannot approve. The app guides you; it takes a minute.",
          ],
        },
      };
    },
  };
}

export function claimFiledForValidator(params: {
  validatorId: string;
  ownerId: string;
  contractId: string;
  category: string;
  claimantId: string;
  contestUntil: string;
}): NotificationDraft {
  const name = contractName(params.category);
  const label = categoryLabel(params.category);
  return {
    userId: params.validatorId,
    type: "claim_filed_validator",
    mentions: [params.ownerId, params.claimantId],
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
    email: (ctx) => {
      const owner = ctx.name(params.ownerId);
      const first = ctx.firstName(params.ownerId);
      const claimant = ctx.name(params.claimantId);
      const until = ctx.at(params.contestUntil);
      const known = (label: string, value: string | null): EmailFact[] =>
        value ? [{ label, value }] : [];
      return {
        fr: {
          subject: owner ? `Votre avis est demandé pour ${owner}` : undefined,
          paragraphs: [
            `${claimant ?? "Quelqu'un"} demande la transmission du contrat ${name.fr} de ${owner ?? "l'un de vos proches"}.`,
            `En tant que validateur, n'approuvez que si vous êtes sûr que ${first ?? "le propriétaire"} ne peut plus agir ; sinon, refusez. En cas de doute, essayez de ${first ? `joindre ${first}` : "le joindre"} par un autre moyen.`,
            `${first ?? "Le propriétaire"} peut encore annuler la demande jusqu'au ${until.fr}.`,
          ],
          facts: [
            { label: "Contrat", value: label.fr },
            ...known("Propriétaire", owner),
            ...known("Demandée par", claimant),
            { label: "Annulation possible jusqu'au", value: until.fr },
          ],
        },
        en: {
          subject: owner ? `Your decision is needed for ${owner}` : undefined,
          paragraphs: [
            `${claimant ?? "Someone"} requests the handover of ${possessive(owner)} contract ${name.en}.`,
            `As a validator, only approve it if you are sure ${first ?? "the owner"} can no longer act; otherwise, refuse it. If in doubt, try to reach ${first ?? "them"} by some other means.`,
            `${first ?? "The owner"} can still cancel the request until ${until.en}.`,
          ],
          facts: [
            { label: "Contract", value: label.en },
            ...known("Owner", owner),
            ...known("Requested by", claimant),
            { label: "Can be cancelled until", value: until.en },
          ],
        },
      };
    },
  };
}

/** Enough validators approved: the owner has until the end of the window to stop it. */
export function claimQuorumReached(params: {
  ownerId: string;
  contractId: string;
  category: string;
  contestUntil: string;
}): NotificationDraft {
  const name = contractName(params.category);
  const label = categoryLabel(params.category);
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
    email: (ctx) => {
      const until = ctx.at(params.contestUntil);
      return {
        fr: {
          subject: `Transmission imminente : ${name.fr}`,
          paragraphs: [
            `Assez de validateurs ont approuvé la demande de transmission de votre contrat ${name.fr}.`,
            `Si vous êtes là, annulez-la dans l'app avant le ${until.fr} : passé ce moment, l'accès sera transmis.`,
          ],
          facts: [
            { label: "Contrat", value: label.fr },
            { label: "Transmission le", value: until.fr },
          ],
        },
        en: {
          subject: `Handover coming soon: ${name.en}`,
          paragraphs: [
            `Enough validators approved the handover request for your contract ${name.en}.`,
            `If you're still here, cancel it in the app before ${until.en}: after that, access will be handed over.`,
          ],
          facts: [
            { label: "Contract", value: label.en },
            { label: "Handover on", value: until.en },
          ],
        },
      };
    },
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
  ownerId: string;
  claimantId: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.userId,
    type: "claim_closed",
    mentions: [params.ownerId, params.claimantId],
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
    email: (ctx) => {
      const mine = params.userId === params.ownerId;
      const owner = ctx.name(params.ownerId);
      const claimant = ctx.name(params.claimantId);
      // "de votre contrat « … »" or "du contrat « … » de Camille Martin".
      const ofContract = {
        fr: mine
          ? `de votre contrat ${name.fr}`
          : `du contrat ${name.fr}${owner ? ` de ${owner}` : ""}`,
        en: mine
          ? `your contract ${name.en}`
          : `${possessive(owner)} contract ${name.en}`,
      };
      const what: Record<Language, Record<string, string>> = {
        fr: {
          cancelled: `${owner ?? "Le propriétaire"} a annulé la demande de transmission ${ofContract.fr}.`,
          withdrawn: `${claimant ?? "Le demandeur"} a retiré sa demande de transmission ${ofContract.fr}.`,
          rejected: `Les validateurs ont refusé la demande de transmission ${ofContract.fr}.`,
          expired: `La demande de transmission ${ofContract.fr} a expiré sans avoir réuni assez d'approbations.`,
          revoked: `${owner ?? "Le propriétaire"} a révoqué le contrat : la demande de transmission ${ofContract.fr} est close.`,
          participant_left: `Un participant a supprimé son compte : la demande de transmission ${ofContract.fr} est close.`,
        },
        en: {
          cancelled: `${owner ?? "The owner"} cancelled the handover request for ${ofContract.en}.`,
          withdrawn: `${claimant ?? "The requester"} withdrew their handover request for ${ofContract.en}.`,
          rejected: `The validators refused the handover request for ${ofContract.en}.`,
          expired: `The handover request for ${ofContract.en} expired without enough approvals.`,
          revoked: `${owner ?? "The owner"} revoked the contract: the handover request for ${ofContract.en} is closed.`,
          participant_left: `A participant deleted their account: the handover request for ${ofContract.en} is closed.`,
        },
      };
      return {
        fr: {
          paragraphs: [
            what.fr[params.reason] ??
              `La demande de transmission ${ofContract.fr} est close.`,
            "Rien ne sera transmis.",
          ],
        },
        en: {
          paragraphs: [
            what.en[params.reason] ??
              `The handover request for ${ofContract.en} is closed.`,
            "Nothing will be handed over.",
          ],
        },
      };
    },
  };
}

/** The accessor may now open what was entrusted to them. */
export function contractReleasedForAccessor(params: {
  accessorId: string;
  ownerId: string;
  contractId: string;
  category: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.accessorId,
    type: "contract_released",
    mentions: [params.ownerId],
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
    email: (ctx) => {
      const owner = ctx.name(params.ownerId);
      return {
        fr: {
          subject: `Accès transmis : ${name.fr}`,
          paragraphs: [
            `L'accès au contrat ${name.fr}${owner ? ` de ${owner}` : ""} vous a été transmis.`,
            "Ouvrez l'app BehyndMe pour le lire. Vos clés de chiffrement sont nécessaires : si vous avez changé de téléphone, restaurez-les d'abord.",
          ],
        },
        en: {
          subject: `Access handed over: ${name.en}`,
          paragraphs: [
            `Access to ${possessive(owner)} contract ${name.en} has been handed over to you.`,
            "Open the BehyndMe app to read it. Your encryption keys are needed: if you changed phones, restore them first.",
          ],
        },
      };
    },
  };
}

/** A day before the end of the contest window: the owner's last chance to say they are there. */
export function claimReminderForOwner(params: {
  ownerId: string;
  contractId: string;
  category: string;
  quorum: boolean;
  contestUntil: string;
}): NotificationDraft {
  const name = contractName(params.category);
  const label = categoryLabel(params.category);
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
    email: (ctx) => {
      const until = ctx.at(params.contestUntil);
      return {
        fr: {
          subject: `Dernier rappel : ${name.fr}`,
          paragraphs: params.quorum
            ? [
                `La transmission de votre contrat ${name.fr} aura lieu le ${until.fr} : assez de validateurs l'ont approuvée.`,
                "Si vous êtes là, annulez-la dans l'app d'ici là.",
              ]
            : [
                `Une demande de transmission de votre contrat ${name.fr} est toujours ouverte. Le délai pour l'annuler se termine le ${until.fr}.`,
                "Si vous êtes là, annulez-la dans l'app maintenant : ensuite, l'accès sera transmis dès que les validateurs l'auront approuvée.",
              ],
          facts: [
            { label: "Contrat", value: label.fr },
            { label: "Annulation possible jusqu'au", value: until.fr },
          ],
        },
        en: {
          subject: `Last reminder: ${name.en}`,
          paragraphs: params.quorum
            ? [
                `The handover of your contract ${name.en} will take place on ${until.en}: enough validators approved it.`,
                "If you're still here, cancel it in the app before then.",
              ]
            : [
                `A handover request for your contract ${name.en} is still open. The time to cancel it ends on ${until.en}.`,
                "If you're still here, cancel it in the app now: after that, access will be handed over as soon as the validators have approved it.",
              ],
          facts: [
            { label: "Contract", value: label.en },
            { label: "Can be cancelled until", value: until.en },
          ],
        },
      };
    },
  };
}

export function claimReminderForValidator(params: {
  validatorId: string;
  ownerId: string;
  contractId: string;
  category: string;
  contestUntil: string;
}): NotificationDraft {
  const name = contractName(params.category);
  return {
    userId: params.validatorId,
    type: "claim_reminder_validator",
    mentions: [params.ownerId],
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
    email: (ctx) => {
      const owner = ctx.name(params.ownerId);
      const first = ctx.firstName(params.ownerId);
      const until = ctx.at(params.contestUntil);
      return {
        fr: {
          paragraphs: [
            `La demande de transmission du contrat ${name.fr} de ${owner ?? "l'un de vos proches"} attend toujours votre avis.`,
            `N'approuvez que si vous êtes sûr que ${first ?? "le propriétaire"} ne peut plus agir ; sinon, refusez. ${first ?? "Le propriétaire"} peut encore l'annuler jusqu'au ${until.fr}.`,
          ],
        },
        en: {
          paragraphs: [
            `The handover request for ${possessive(owner)} contract ${name.en} is still waiting for your decision.`,
            `Only approve it if you are sure ${first ?? "the owner"} can no longer act; otherwise, refuse it. ${first ?? "The owner"} can still cancel it until ${until.en}.`,
          ],
        },
      };
    },
  };
}

/** Nobody can open the contract any more: its accessor and validators are told why. */
export function contractRevoked(params: {
  userId: string;
  ownerId: string;
  contractId: string;
  category: string;
  reason: string;
}): NotificationDraft {
  const name = contractName(params.category);
  const ownerLeft = params.reason === "account_deleted";
  return {
    userId: params.userId,
    type: "contract_revoked",
    mentions: [params.ownerId],
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
    email: (ctx) => {
      // A deleted account may already be forgotten here: the sentence then says "the owner".
      const owner = ctx.name(params.ownerId);
      return {
        fr: {
          paragraphs: [
            ownerLeft
              ? `${owner ?? "Le propriétaire"} a supprimé son compte BehyndMe : le contrat ${name.fr} est révoqué, plus personne ne peut l'ouvrir.`
              : `${owner ?? "Le propriétaire"} a révoqué le contrat ${name.fr} : plus personne ne peut l'ouvrir.`,
            "Vous n'avez rien à faire.",
          ],
        },
        en: {
          paragraphs: [
            ownerLeft
              ? `${owner ?? "The owner"} deleted their BehyndMe account: the contract ${name.en} is revoked, and nobody can open it any more.`
              : `${owner ?? "The owner"} revoked the contract ${name.en}: nobody can open it any more.`,
            "There is nothing for you to do.",
          ],
        },
      };
    },
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
    email: () => ({
      fr: {
        paragraphs: accessor
          ? [
              `L'accesseur de votre contrat ${name.fr} a supprimé son compte BehyndMe.`,
              "Pour que ce contrat puisse encore être transmis, choisissez un autre accesseur et scellez-le à nouveau dans l'app.",
            ]
          : [
              `Un validateur de votre contrat ${name.fr} a supprimé son compte BehyndMe : sa part de la clé est perdue.`,
              "Scellez le contrat à nouveau dans l'app pour choisir un autre validateur.",
            ],
      },
      en: {
        paragraphs: accessor
          ? [
              `The recipient of your contract ${name.en} deleted their BehyndMe account.`,
              "So that this contract can still be handed over, choose another recipient and seal it again in the app.",
            ]
          : [
              `A validator of your contract ${name.en} deleted their BehyndMe account: their part of the key is lost.`,
              "Seal the contract again in the app to choose another validator.",
            ],
      },
    }),
  };
}
