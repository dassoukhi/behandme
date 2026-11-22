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

/** `inviteeName` accepted an invitation of `userId`, who now trusts them (and is trusted back if `trustedBack`). */
export function invitationAccepted(params: {
  userId: string;
  inviteeId: string;
  inviteeName: string | null;
  trustedBack: boolean;
}): NotificationDraft {
  const fr = params.inviteeName ?? "Quelqu'un";
  const en = params.inviteeName ?? "Someone";
  return {
    userId: params.userId,
    type: "invitation_accepted",
    copy: {
      fr: {
        title: "Invitation acceptée",
        body: params.trustedBack
          ? `${fr} a accepté votre invitation et vous a ajouté à ses proches.`
          : `${fr} a accepté votre invitation : cette personne fait partie de vos proches.`,
      },
      en: {
        title: "Invitation accepted",
        body: params.trustedBack
          ? `${en} accepted your invitation and added you as a trusted contact.`
          : `${en} accepted your invitation and is now one of your trusted contacts.`,
      },
    },
    data: { url: `/people/${params.inviteeId}` },
    critical: false,
    mentions: [params.inviteeId],
    email: (ctx) => {
      const invitee = ctx.name(params.inviteeId);
      const first = ctx.firstName(params.inviteeId);
      return {
        fr: {
          subject: invitee
            ? `${invitee} a accepté votre invitation`
            : undefined,
          paragraphs: [
            `${invitee ?? "La personne que vous avez invitée"} a accepté votre invitation sur BehyndMe : elle fait désormais partie de vos proches.`,
            params.trustedBack
              ? `${first ?? "Elle"} vous a aussi ajouté à ses proches.`
              : `Vous pouvez désormais lui confier un accès, ou lui demander de valider sa transmission.`,
            `Avant de confier un accès à ${first ?? "cette personne"}, scannez son code quand vous la voyez : vous saurez que ses clés sont bien les siennes. Vous la retrouverez dans l'app, onglet Proches.`,
          ],
        },
        en: {
          subject: invitee ? `${invitee} accepted your invitation` : undefined,
          paragraphs: [
            `${invitee ?? "The person you invited"} accepted your invitation on BehyndMe and is now one of your trusted contacts.`,
            params.trustedBack
              ? `${first ?? "They"} also added you as a trusted contact.`
              : `You can now entrust them with an access, or ask them to validate its handover.`,
            `Before entrusting ${first ?? "them"} with an access, scan their code when you see them: you will know their keys are really theirs. You will find them in the app, in the Contacts tab.`,
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
            `Si c'est vous, tout est en ordre. Par sécurité, vos nouvelles clés ne serviront à sceller une enveloppe qu'à partir du ${usable.fr}.`,
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
            `If it was you, all is well. For security, your new keys can only be used to seal an envelope from ${usable.en}.`,
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
          "Profitez-en pour relire vos enveloppes et les personnes qu'elles désignent.",
        ],
      },
      en: {
        paragraphs: [
          "Your yearly BehyndMe check-up is due.",
          "Opening the app for a minute is enough: it checks that your keys are still there, and lets the people who count on you know.",
          "Take the chance to review your envelopes and the people they name.",
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
    finances: "Banque et cryptomonnaies",
  },
  en: {
    networks: "Social media",
    devices: "Devices",
    storage: "Online storage",
    finances: "Bank and crypto",
  },
};
const categoryLabel = (category: string) => ({
  fr: CATEGORY.fr[category] ?? "Enveloppe",
  en: CATEGORY.en[category] ?? "Envelope",
});
const contractName = (category: string) => ({
  fr: `« ${categoryLabel(category).fr} »`,
  en: `“${categoryLabel(category).en}”`,
});

/** "Camille Martin's", or "the" when the owner is unknown: "Camille Martin's envelope “Devices”". */
const possessive = (name: string | null) => (name ? `${name}'s` : "the");

/** The rules someone named in an envelope is part of: how many approvals release it, and the days to cancel. */
interface SealedRules {
  ownerId: string;
  category: string;
  validatorCount: number;
  threshold: number;
  contestDays: number;
  /** A claim may also say the owner can no longer act; otherwise only that they died. */
  incapacityAllowed: boolean;
}

/** When the envelope may be handed over: after the owner's death, or also if they can no longer act. */
const whenFor = (
  rules: Pick<SealedRules, "incapacityAllowed">,
  first: string | null,
  forAccessor: boolean,
) => {
  const who = first ?? "cette personne";
  const theirs = first ? `${first}'s` : "their";
  const they = first ?? "they";
  return rules.incapacityAllowed
    ? {
        fr: forAccessor
          ? `qu'après le décès de ${who}, ou si un jour ${who} ne peut plus agir`
          : `qu'en cas de décès de ${who}, ou si ${who} ne peut plus agir`,
        en: forAccessor
          ? `after ${theirs} death, or if one day ${they} can no longer act`
          : `after ${theirs} death, or if ${they} can no longer act`,
      }
    : {
        fr: forAccessor
          ? `qu'après le décès de ${who}`
          : `qu'en cas de décès de ${who}`,
        en: `after ${theirs} death`,
      };
};

/** The reason a claimant gave, as an e-mail fact. */
const REASON: Record<Language, Record<string, string>> = {
  fr: { death: "Décès", incapacity: "Ne peut plus agir" },
  en: { death: "Death", incapacity: "Can no longer act" },
};

const days = (count: number) => ({
  fr: `${count} jour${count > 1 ? "s" : ""}`,
  en: `${count} day${count > 1 ? "s" : ""}`,
});

/** For a validator: "Votre accord suffit" alone, "Il faut 2 validations sur 3" among others. */
const quorumForValidator = ({ threshold, validatorCount }: SealedRules) =>
  validatorCount === 1
    ? { fr: "Votre accord suffit", en: "Your approval is enough" }
    : {
        fr: `Il faut ${threshold} validations sur ${validatorCount}`,
        en: `It takes ${threshold} approvals out of ${validatorCount}`,
      };

/** For the accessor: whose approval opens it ("l'accord de 2 de ses 3 validateurs"). */
const quorumForAccessor = ({ threshold, validatorCount }: SealedRules) =>
  validatorCount === 1
    ? {
        fr: "l'accord de son validateur",
        en: "the approval of their validator",
      }
    : threshold === validatorCount
      ? validatorCount === 2
        ? {
            fr: "l'accord de ses deux validateurs",
            en: "the approval of both of their validators",
          }
        : {
            fr: `l'accord de ses ${validatorCount} validateurs`,
            en: `the approval of all ${validatorCount} of their validators`,
          }
      : {
          fr: `l'accord de ${threshold} de ses ${validatorCount} validateurs`,
          en: `the approval of ${threshold} of their ${validatorCount} validators`,
        };

/** Where people named in an envelope read what we keep about them, and their rights (never a link in an e-mail). */
const RIGHTS = {
  fr: "Ce que nous gardons à votre sujet et vos droits : Réglages › Confidentialité, dans l'app.",
  en: "What we keep about you, and your rights: Settings › Privacy, in the app.",
};

/** Someone says the owner can no longer act: the owner must be able to stop it at once. */
export function claimFiledForOwner(params: {
  ownerId: string;
  contractId: string;
  category: string;
  claimantId: string;
  /** death or incapacity: what the claimant says. Never on the lock screen. */
  claimReason: string;
  contestUntil: string;
}): NotificationDraft {
  const death = params.claimReason !== "incapacity";
  const name = contractName(params.category);
  const label = categoryLabel(params.category);
  return {
    userId: params.ownerId,
    type: "claim_filed_owner",
    mentions: [params.claimantId],
    copy: {
      fr: {
        title: "Demande de transmission",
        body: `Une transmission de votre enveloppe ${name.fr} a été demandée. Si vous êtes là, annulez-la dans l'app.`,
      },
      en: {
        title: "Handover request",
        body: `A handover of your envelope ${name.en} was requested. If you're still here, cancel it in the app.`,
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
            `${claimant ?? "Quelqu'un"} a demandé la transmission de votre enveloppe ${name.fr}, le ${ctx.occurred.fr}, en indiquant ${death ? "votre décès" : "que vous ne pouvez plus agir"}.`,
            "Si vous êtes là, annulez la demande dans l'app : rien ne sera transmis.",
            `Sinon, l'enveloppe sera transmise à partir du ${until.fr}, dès que vos validateurs auront approuvé la demande.`,
          ],
          facts: [
            { label: "Enveloppe", value: label.fr },
            ...requestedBy("Demandée par"),
            {
              label: "Motif",
              value: REASON.fr[death ? "death" : "incapacity"],
            },
            { label: "Annulation possible jusqu'au", value: until.fr },
          ],
        },
        en: {
          subject: `Handover request: ${name.en}`,
          paragraphs: [
            `${claimant ?? "Someone"} requested the handover of your envelope ${name.en} on ${ctx.occurred.en}, saying ${death ? "that you have died" : "that you can no longer act"}.`,
            "If you're still here, cancel the request in the app: nothing will be handed over.",
            `Otherwise, the envelope will be handed over from ${until.en}, as soon as your validators have approved the request.`,
          ],
          facts: [
            { label: "Envelope", value: label.en },
            ...requestedBy("Requested by"),
            {
              label: "Reason",
              value: REASON.en[death ? "death" : "incapacity"],
            },
            { label: "Can be cancelled until", value: until.en },
          ],
        },
      };
    },
  };
}

/**
 * Someone now holds a share of a contract: they should know, and keep their keys. Category only; it opens
 * the screen where they keep their keys, the one thing to do. The e-mail says what the role is and is not (they never
 * see the content, nothing obliges them to approve, it has no effect on an estate), the rules it is part of, and how to
 * step back.
 */
export function chosenAsValidator(
  params: SealedRules & { validatorId: string },
): NotificationDraft {
  const name = contractName(params.category);
  const quorum = quorumForValidator(params);
  const delay = days(params.contestDays);
  return {
    userId: params.validatorId,
    type: "validator_chosen",
    mentions: [params.ownerId],
    copy: {
      fr: {
        title: "Un proche compte sur vous",
        body: `Vous êtes validateur de l'enveloppe ${name.fr}. Gardez vos clés à l'abri : une minute suffit.`,
      },
      en: {
        title: "Someone close is counting on you",
        body: `You are a validator of the envelope ${name.en}. Keep your keys safe: it takes a minute.`,
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
            `${owner ?? "Un proche"} vous a choisi comme validateur de son enveloppe ${name.fr}.`,
            `Le jour où quelqu'un demandera sa transmission, votre avis sera demandé : vous ne l'approuverez ${whenFor(params, first, false).fr}, et si vous en êtes sûr. ${quorum.fr}, et ${first ?? "cette personne"} dispose de ${delay.fr} après la demande pour l'annuler.`,
            `Vous ne verrez jamais ce que contient l'enveloppe. Ce rôle ne vous oblige à rien, ne vous donne aucun droit sur ses biens et ne remplace aucune démarche de succession. Si vous ne souhaitez pas le tenir, refusez-le dans l'app : ouvrez l'enveloppe et touchez « Refuser ce rôle ». Nous préviendrons ${first ?? "cette personne"}, qui pourra choisir quelqu'un d'autre.`,
            "D'ici là, gardez vos clés à l'abri : sans elles, vous ne pourrez pas approuver. L'app vous guide, une minute suffit.",
            RIGHTS.fr,
          ],
        },
        en: {
          subject: owner ? `${owner} is counting on you` : undefined,
          paragraphs: [
            `${owner ?? "Someone close to you"} chose you as a validator of their envelope ${name.en}.`,
            `The day someone requests its handover, you will be asked for your decision: only approve it ${whenFor(params, first, false).en}, and if you are sure of it. ${quorum.en}, and ${first ? `${first} has` : "they have"} ${delay.en} after the request to cancel it.`,
            `You will never see what the envelope holds. This role obliges you to nothing, gives you no right to their property and replaces no step of an estate settlement. If you would rather not hold it, decline it in the app: open the envelope and tap “Decline this role”. We will tell ${first ?? "them"}, who can then choose someone else.`,
            "Until then, keep your keys safe: without them, you cannot approve. The app guides you; it takes a minute.",
            RIGHTS.en,
          ],
        },
      };
    },
  };
}

/**
 * Someone is now the accessor of a contract. They hold nothing to keep (validators re-wrap their shares to the
 * accessor's keys at the claim), but should know they were chosen, what the envelope may give them one day, and what it
 * does not: no right to the owner's property, only what the owner asked of them. It opens the envelope's screen.
 */
export function chosenAsAccessor(
  params: SealedRules & { accessorId: string; contractId: string },
): NotificationDraft {
  const name = contractName(params.category);
  const quorum = quorumForAccessor(params);
  const delay = days(params.contestDays);
  return {
    userId: params.accessorId,
    type: "accessor_chosen",
    mentions: [params.ownerId],
    copy: {
      fr: {
        title: "Une enveloppe vous est destinée",
        body: `Vous êtes le destinataire de l'enveloppe ${name.fr}. Vous n'avez rien à faire pour l'instant.`,
      },
      en: {
        title: "An envelope is meant for you",
        body: `You are the recipient of the envelope ${name.en}. There is nothing for you to do for now.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: false,
    email: (ctx) => {
      const owner = ctx.name(params.ownerId);
      const first = ctx.firstName(params.ownerId);
      return {
        fr: {
          subject: owner
            ? `${owner} vous a choisi comme destinataire`
            : undefined,
          paragraphs: [
            `${owner ?? "Un proche"} vous a choisi comme destinataire de son enveloppe ${name.fr}.`,
            `Elle reste scellée : vous ne pourrez l'ouvrir ${whenFor(params, first, true).fr}, avec ${quorum.fr}. ${first ?? "Cette personne"} reçoit aussitôt une alerte et dispose de ${delay.fr} pour annuler la demande.`,
            `Ces accès ne vous donneront aucun droit sur ses biens : servez-vous-en seulement pour ce que ${first ?? "cette personne"} vous aura demandé.`,
            `Vous n'avez rien à faire pour l'instant. Si vous ne souhaitez pas ce rôle, refusez-le dans l'app : ouvrez l'enveloppe et touchez « Refuser ce rôle ». Nous préviendrons ${first ?? "cette personne"}, qui pourra choisir quelqu'un d'autre.`,
            RIGHTS.fr,
          ],
        },
        en: {
          subject: owner ? `${owner} chose you as a recipient` : undefined,
          paragraphs: [
            `${owner ?? "Someone close to you"} chose you as the recipient of their envelope ${name.en}.`,
            `It stays sealed: you can open it only ${whenFor(params, first, true).en}, with ${quorum.en}. ${first ? `${first} is alerted at once and has` : "They are alerted at once and have"} ${delay.en} to cancel the request.`,
            `This access will give you no right to their property: use it only for what ${first ?? "they"} will have asked of you.`,
            `There is nothing to do for now. If you would rather not hold this role, decline it in the app: open the envelope and tap “Decline this role”. We will tell ${first ?? "them"}, who can then choose someone else.`,
            RIGHTS.en,
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
  /** death or incapacity: what the claimant says. Never on the lock screen. */
  claimReason: string;
  contestUntil: string;
}): NotificationDraft {
  const death = params.claimReason !== "incapacity";
  const name = contractName(params.category);
  const label = categoryLabel(params.category);
  return {
    userId: params.validatorId,
    type: "claim_filed_validator",
    mentions: [params.ownerId, params.claimantId],
    copy: {
      fr: {
        title: "Votre avis est demandé",
        body: `Une transmission de l'enveloppe ${name.fr} a été demandée : approuvez-la ou refusez-la.`,
      },
      en: {
        title: "Your decision is needed",
        body: `A handover of the envelope ${name.en} was requested: approve or refuse it.`,
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
            `${claimant ?? "Quelqu'un"} demande la transmission de l'enveloppe ${name.fr} de ${owner ?? "l'un de vos proches"}, en indiquant ${death ? `le décès de ${first ?? "cette personne"}` : `que ${first ?? "cette personne"} ne peut plus agir`}.`,
            `En tant que validateur, n'approuvez que si vous en êtes sûr ; sinon, refusez. En cas de doute, essayez de ${first ? `joindre ${first}` : "le joindre"} par un autre moyen.`,
            `${first ?? "Le propriétaire"} peut encore annuler la demande jusqu'au ${until.fr}.`,
          ],
          facts: [
            { label: "Enveloppe", value: label.fr },
            ...known("Propriétaire", owner),
            ...known("Demandée par", claimant),
            {
              label: "Motif",
              value: REASON.fr[death ? "death" : "incapacity"],
            },
            { label: "Annulation possible jusqu'au", value: until.fr },
          ],
        },
        en: {
          subject: owner ? `Your decision is needed for ${owner}` : undefined,
          paragraphs: [
            `${claimant ?? "Someone"} requests the handover of ${possessive(owner)} envelope ${name.en}, saying ${death ? `that ${first ?? "the owner"} has died` : `that ${first ?? "the owner"} can no longer act`}.`,
            `As a validator, only approve it if you are sure of it; otherwise, refuse it. If in doubt, try to reach ${first ?? "them"} by some other means.`,
            `${first ?? "The owner"} can still cancel the request until ${until.en}.`,
          ],
          facts: [
            { label: "Envelope", value: label.en },
            ...known("Owner", owner),
            ...known("Requested by", claimant),
            {
              label: "Reason",
              value: REASON.en[death ? "death" : "incapacity"],
            },
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
            `Assez de validateurs ont approuvé la demande de transmission de votre enveloppe ${name.fr}.`,
            `Si vous êtes là, annulez-la dans l'app avant le ${until.fr} : passé ce moment, l'enveloppe sera transmise.`,
          ],
          facts: [
            { label: "Enveloppe", value: label.fr },
            { label: "Transmission le", value: until.fr },
          ],
        },
        en: {
          subject: `Handover coming soon: ${name.en}`,
          paragraphs: [
            `Enough validators approved the handover request for your envelope ${name.en}.`,
            `If you're still here, cancel it in the app before ${until.en}: after that, the envelope will be handed over.`,
          ],
          facts: [
            { label: "Envelope", value: label.en },
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
    revoked: "Le propriétaire a révoqué l'enveloppe",
    participant_left:
      "Un participant a quitté l'enveloppe : la demande de transmission est close",
  },
  en: {
    cancelled: "The owner cancelled the handover request",
    withdrawn: "The handover request was withdrawn",
    rejected: "The validators refused the handover request",
    expired: "The handover request expired",
    revoked: "The owner revoked the envelope",
    participant_left:
      "A participant left the envelope: the handover request is closed",
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
      // "de votre enveloppe « … »" or "de l'enveloppe « … » de Camille Martin".
      const ofContract = {
        fr: mine
          ? `de votre enveloppe ${name.fr}`
          : `de l'enveloppe ${name.fr}${owner ? ` de ${owner}` : ""}`,
        en: mine
          ? `your envelope ${name.en}`
          : `${possessive(owner)} envelope ${name.en}`,
      };
      const what: Record<Language, Record<string, string>> = {
        fr: {
          cancelled: `${owner ?? "Le propriétaire"} a annulé la demande de transmission ${ofContract.fr}.`,
          withdrawn: `${claimant ?? "Le demandeur"} a retiré sa demande de transmission ${ofContract.fr}.`,
          rejected: `Les validateurs ont refusé la demande de transmission ${ofContract.fr}.`,
          expired: `La demande de transmission ${ofContract.fr} a expiré sans avoir réuni assez d'approbations.`,
          revoked: `${owner ?? "Le propriétaire"} a révoqué l'enveloppe : la demande de transmission ${ofContract.fr} est close.`,
          participant_left: `Un participant a quitté l'enveloppe : la demande de transmission ${ofContract.fr} ne peut plus aboutir, elle est close.`,
        },
        en: {
          cancelled: `${owner ?? "The owner"} cancelled the handover request for ${ofContract.en}.`,
          withdrawn: `${claimant ?? "The requester"} withdrew their handover request for ${ofContract.en}.`,
          rejected: `The validators refused the handover request for ${ofContract.en}.`,
          expired: `The handover request for ${ofContract.en} expired without enough approvals.`,
          revoked: `${owner ?? "The owner"} revoked the envelope: the handover request for ${ofContract.en} is closed.`,
          participant_left: `A participant left the envelope: the handover request for ${ofContract.en} can no longer succeed, and is closed.`,
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
        title: "Enveloppe transmise",
        body: `L'enveloppe ${name.fr} vous a été transmise : vous pouvez l'ouvrir dans l'app.`,
      },
      en: {
        title: "Envelope handed over",
        body: `The envelope ${name.en} has been handed over to you: you can open it in the app.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: true,
    email: (ctx) => {
      const owner = ctx.name(params.ownerId);
      return {
        fr: {
          subject: `Enveloppe transmise : ${name.fr}`,
          paragraphs: [
            `L'enveloppe ${name.fr}${owner ? ` de ${owner}` : ""} vous a été transmise.`,
            "Ouvrez l'app BehyndMe pour la lire. Vos clés de chiffrement sont nécessaires : si vous avez changé de téléphone, restaurez-les d'abord.",
          ],
        },
        en: {
          subject: `Envelope handed over: ${name.en}`,
          paragraphs: [
            `${owner ? `${owner}'s` : "The"} envelope ${name.en} has been handed over to you.`,
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
                `La transmission de votre enveloppe ${name.fr} aura lieu le ${until.fr} : assez de validateurs l'ont approuvée.`,
                "Si vous êtes là, annulez-la dans l'app d'ici là.",
              ]
            : [
                `Une demande de transmission de votre enveloppe ${name.fr} est toujours ouverte. Le délai pour l'annuler se termine le ${until.fr}.`,
                "Si vous êtes là, annulez-la dans l'app maintenant : ensuite, l'enveloppe sera transmise dès que les validateurs auront approuvé la demande.",
              ],
          facts: [
            { label: "Enveloppe", value: label.fr },
            { label: "Annulation possible jusqu'au", value: until.fr },
          ],
        },
        en: {
          subject: `Last reminder: ${name.en}`,
          paragraphs: params.quorum
            ? [
                `The handover of your envelope ${name.en} will take place on ${until.en}: enough validators approved it.`,
                "If you're still here, cancel it in the app before then.",
              ]
            : [
                `A handover request for your envelope ${name.en} is still open. The time to cancel it ends on ${until.en}.`,
                "If you're still here, cancel it in the app now: after that, the envelope will be handed over as soon as the validators have approved the request.",
              ],
          facts: [
            { label: "Envelope", value: label.en },
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
            `La demande de transmission de l'enveloppe ${name.fr} de ${owner ?? "l'un de vos proches"} attend toujours votre avis.`,
            `N'approuvez que si vous êtes sûr que ${first ?? "le propriétaire"} ne peut plus agir ; sinon, refusez. ${first ?? "Le propriétaire"} peut encore l'annuler jusqu'au ${until.fr}.`,
          ],
        },
        en: {
          paragraphs: [
            `The handover request for ${possessive(owner)} envelope ${name.en} is still waiting for your decision.`,
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
        title: "Enveloppe révoquée",
        body: ownerLeft
          ? `Le propriétaire a supprimé son compte : l'enveloppe ${name.fr} est révoquée.`
          : `Le propriétaire a révoqué l'enveloppe ${name.fr}.`,
      },
      en: {
        title: "Envelope revoked",
        body: ownerLeft
          ? `The owner deleted their account: the envelope ${name.en} is revoked.`
          : `The owner revoked the envelope ${name.en}.`,
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
              ? `${owner ?? "Le propriétaire"} a supprimé son compte BehyndMe : l'enveloppe ${name.fr} est révoquée, plus personne ne peut l'ouvrir.`
              : `${owner ?? "Le propriétaire"} a révoqué l'enveloppe ${name.fr} : plus personne ne peut l'ouvrir.`,
            "Vous n'avez rien à faire.",
          ],
        },
        en: {
          paragraphs: [
            ownerLeft
              ? `${owner ?? "The owner"} deleted their BehyndMe account: the envelope ${name.en} is revoked, and nobody can open it any more.`
              : `${owner ?? "The owner"} revoked the envelope ${name.en}: nobody can open it any more.`,
            "There is nothing for you to do.",
          ],
        },
      };
    },
  };
}

/** What the owner reads when someone left: by why, then by their role; `who` names whoever declined. */
interface LeftCopy {
  title: string;
  push: (envelope: string) => string;
  email: (envelope: string, who: string | null) => string[];
}
const SEAL_AGAIN = {
  accessor: {
    fr: "Pour que cette enveloppe puisse encore être transmise, choisissez un autre destinataire et scellez-la à nouveau dans l'app.",
    en: "So that this envelope can still be handed over, choose another recipient and seal it again in the app.",
  },
  validator: {
    fr: "Scellez l'enveloppe à nouveau dans l'app pour choisir un autre validateur.",
    en: "Seal the envelope again in the app to choose another validator.",
  },
};
const LEFT: Record<
  "declined" | "account_deleted",
  Record<"accessor" | "validator", Record<Language, LeftCopy>>
> = {
  declined: {
    accessor: {
      fr: {
        title: "Rôle refusé",
        push: (e) =>
          `Le destinataire de votre enveloppe ${e} a refusé son rôle : choisissez-en un autre et scellez-la à nouveau.`,
        email: (e, who) => [
          `${who ?? "Le destinataire"} a refusé d'être le destinataire de votre enveloppe ${e} : cette personne ne la voit plus et ne pourra pas l'ouvrir.`,
          SEAL_AGAIN.accessor.fr,
        ],
      },
      en: {
        title: "Role declined",
        push: (e) =>
          `The recipient of your envelope ${e} declined their role: choose another one and seal again.`,
        email: (e, who) => [
          `${who ?? "The recipient"} declined to be the recipient of your envelope ${e}: they no longer see it and will not be able to open it.`,
          SEAL_AGAIN.accessor.en,
        ],
      },
    },
    validator: {
      fr: {
        title: "Rôle refusé",
        push: (e) =>
          `Un validateur de votre enveloppe ${e} a refusé son rôle : sa part ne servira pas. Scellez-la à nouveau pour en choisir un autre.`,
        email: (e, who) => [
          `${who ?? "Un validateur"} a refusé d'être validateur de votre enveloppe ${e} : sa part de la clé ne servira pas.`,
          SEAL_AGAIN.validator.fr,
        ],
      },
      en: {
        title: "Role declined",
        push: (e) =>
          `A validator of your envelope ${e} declined their role: their share will not be used. Seal again to choose another one.`,
        email: (e, who) => [
          `${who ?? "A validator"} declined to be a validator of your envelope ${e}: their part of the key will not be used.`,
          SEAL_AGAIN.validator.en,
        ],
      },
    },
  },
  account_deleted: {
    accessor: {
      fr: {
        title: "Départ du destinataire",
        push: (e) =>
          `Le destinataire de votre enveloppe ${e} a supprimé son compte : choisissez-en un autre et scellez-la à nouveau.`,
        email: (e) => [
          `Le destinataire de votre enveloppe ${e} a supprimé son compte BehyndMe.`,
          SEAL_AGAIN.accessor.fr,
        ],
      },
      en: {
        title: "Recipient left",
        push: (e) =>
          `The recipient of your envelope ${e} deleted their account: choose another one and seal again.`,
        email: (e) => [
          `The recipient of your envelope ${e} deleted their BehyndMe account.`,
          SEAL_AGAIN.accessor.en,
        ],
      },
    },
    validator: {
      fr: {
        title: "Départ d'un validateur",
        push: (e) =>
          `Un validateur de votre enveloppe ${e} a supprimé son compte : sa part est perdue. Scellez-la à nouveau pour en choisir un autre.`,
        email: (e) => [
          `Un validateur de votre enveloppe ${e} a supprimé son compte BehyndMe : sa part de la clé est perdue.`,
          SEAL_AGAIN.validator.fr,
        ],
      },
      en: {
        title: "Validator left",
        push: (e) =>
          `A validator of your envelope ${e} deleted their account: their share is lost. Seal again to choose another one.`,
        email: (e) => [
          `A validator of your envelope ${e} deleted their BehyndMe account: their part of the key is lost.`,
          SEAL_AGAIN.validator.en,
        ],
      },
    },
  },
};

/**
 * A participant left: they refused their role (the owner is told who), or deleted their account. The owner
 * should choose someone else and seal again.
 */
export function participantLeft(params: {
  ownerId: string;
  contractId: string;
  category: string;
  participantId: string;
  role: string;
  reason: string;
}): NotificationDraft {
  const name = contractName(params.category);
  const declined = params.reason === "declined";
  const copy =
    LEFT[declined ? "declined" : "account_deleted"][
      params.role === "accessor" ? "accessor" : "validator"
    ];
  return {
    userId: params.ownerId,
    type: "participant_left",
    mentions: declined ? [params.participantId] : [],
    copy: {
      fr: { title: copy.fr.title, body: copy.fr.push(name.fr) },
      en: { title: copy.en.title, body: copy.en.push(name.en) },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: false,
    email: (ctx) => {
      // A deleted account is forgotten here; whoever declined is named.
      const who = declined ? ctx.name(params.participantId) : null;
      return {
        fr: { paragraphs: copy.fr.email(name.fr, who) },
        en: { paragraphs: copy.en.email(name.en, who) },
      };
    },
  };
}

/**
 * The owner of a sealed envelope allowed, or no longer allows, a claim saying they can no longer act: those it names
 * learn when they may be asked to approve, or when it may open for them.
 */
export function rulesChanged(params: {
  userId: string;
  ownerId: string;
  contractId: string;
  category: string;
  incapacityAllowed: boolean;
}): NotificationDraft {
  const name = contractName(params.category);
  const allowed = params.incapacityAllowed;
  return {
    userId: params.userId,
    type: "contract_rules_changed",
    mentions: [params.ownerId],
    copy: {
      fr: {
        title: "Règles de l'enveloppe modifiées",
        body: allowed
          ? `Une demande de transmission de l'enveloppe ${name.fr} peut maintenant dire que son propriétaire ne peut plus agir.`
          : `L'enveloppe ${name.fr} ne se transmet plus qu'après le décès de son propriétaire.`,
      },
      en: {
        title: "Envelope rules changed",
        body: allowed
          ? `A handover request for the envelope ${name.en} may now say that its owner can no longer act.`
          : `The envelope ${name.en} is now handed over only after its owner's death.`,
      },
    },
    data: { url: `/contract/${params.contractId}` },
    critical: false,
    email: (ctx) => {
      const owner = ctx.name(params.ownerId);
      const first = ctx.firstName(params.ownerId);
      const theirs = first ? `${first}'s` : "their";
      return {
        fr: {
          paragraphs: [
            allowed
              ? `${owner ?? "Le propriétaire"} permet maintenant qu'une transmission de son enveloppe ${name.fr} soit demandée si ${first ?? "cette personne"} ne peut plus agir, et plus seulement après son décès.`
              : `${owner ?? "Le propriétaire"} a retiré cette possibilité : son enveloppe ${name.fr} ne se transmet plus qu'après le décès de ${first ?? "cette personne"}.`,
            "Vous n'avez rien à faire.",
          ],
        },
        en: {
          paragraphs: [
            allowed
              ? `${owner ?? "The owner"} now allows a handover of their envelope ${name.en} to be requested if ${first ?? "they"} can no longer act, not only after ${theirs} death.`
              : `${owner ?? "The owner"} withdrew this: their envelope ${name.en} is now handed over only after ${theirs} death.`,
            "There is nothing for you to do.",
          ],
        },
      };
    },
  };
}
