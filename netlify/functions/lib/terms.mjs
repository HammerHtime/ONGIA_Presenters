/**
 * The Presenter Terms every presenter agrees to before signing (Andrew, 17 Oct 2026:
 * professionalism, business attire, representing your organization, and whatever
 * else belongs there). One copy, in both languages: the form shows it in a pop-up
 * and the filed PDF prints the English, so what they read is what is on file.
 * Change the wording here and bump VERSION; each agreement records the version it
 * was signed under.
 */
export const TERMS_VERSION = 1;

export const TERMS = {
  en: {
    title: "ONGIA Presenter Terms",
    intro: "By presenting at an ONGIA training event, you agree to the following.",
    items: [
      ["Professional conduct", "You are representing your organization and ONGIA's training program. Treat attendees, other presenters, volunteers, venue staff and ONGIA staff with courtesy and respect, during your session and throughout the event, including any social events."],
      ["Business attire", "Business attire is expected when you present. Business casual is the minimum while you are at the event."],
      ["Representing your organization", "You are responsible for having your organization's approval to present and to share your material. Make clear when you are giving your own views rather than your organization's position."],
      ["Appropriate content", "Your presentation must suit the audience on the day, which may include community partners from outside the justice community. Do not include identifying details of victims, survivors of trafficking or minors, details of active investigations, source identities, information shared under agency agreements, or anything under a publication ban or court order."],
      ["Accuracy and respect", "Present information accurately, and avoid language or images that stereotype or demean any community, culture or group."],
      ["Time and attendance", "Keep to your session time. Tell ONGIA right away if you can no longer attend or your plans change, so other arrangements can be made."],
      ["Presentation materials", "Send your materials by the dates ONGIA gives you. PowerPoint text should be at least 22-point, and audio or video needs subtitles, a transcript or a narrative."],
      ["Photography and recording", "ONGIA may photograph or record parts of the event. Your choices on this form decide how your photo, materials and summary are used."],
      ["Expenses", "ONGIA covers only the expenses approved in your final Presenter Agreement. Meal claims need a receipt or signed declaration and follow the Treasury Board of Canada Directive."],
      ["Changes", "ONGIA may adjust the schedule or format of the event and will tell you in advance. ONGIA may withdraw an invitation if these terms are not followed."],
    ],
  },
  fr: {
    title: "Conditions applicables aux conférenciers d'ONGIA",
    intro: "En présentant lors d'une formation d'ONGIA, vous acceptez ce qui suit.",
    items: [
      ["Conduite professionnelle", "Vous représentez votre organisation et le programme de formation d'ONGIA. Traitez les participants, les autres conférenciers, les bénévoles, le personnel du lieu et le personnel d'ONGIA avec courtoisie et respect, pendant votre séance et tout au long de l'événement, y compris lors des activités sociales."],
      ["Tenue d'affaires", "Une tenue d'affaires est attendue lorsque vous présentez. La tenue d'affaires décontractée est le minimum pendant l'événement."],
      ["Représenter votre organisation", "Il vous incombe d'obtenir l'approbation de votre organisation pour présenter et partager votre matériel. Précisez lorsque vous exprimez votre opinion personnelle plutôt que la position de votre organisation."],
      ["Contenu approprié", "Votre présentation doit convenir à l'auditoire présent, qui peut inclure des partenaires communautaires de l'extérieur du milieu de la justice. N'incluez aucun renseignement permettant d'identifier des victimes, des survivantes ou survivants de la traite ou des personnes mineures, aucun détail d'enquête en cours, aucune identité de source, aucun renseignement communiqué en vertu d'ententes entre organismes, ni rien qui fasse l'objet d'une interdiction de publication ou d'une ordonnance du tribunal."],
      ["Exactitude et respect", "Présentez l'information avec exactitude et évitez tout langage ou toute image qui stéréotype ou dénigre une communauté, une culture ou un groupe."],
      ["Horaire et présence", "Respectez la durée de votre séance. Avisez ONGIA sans tarder si vous ne pouvez plus être présent ou si vos plans changent, afin que d'autres dispositions puissent être prises."],
      ["Matériel de présentation", "Remettez votre matériel aux dates indiquées par ONGIA. Le texte PowerPoint doit être d'au moins 22 points, et l'audio ou la vidéo doit être accompagné de sous-titres, d'une transcription ou d'une narration."],
      ["Photographies et enregistrements", "ONGIA peut photographier ou enregistrer certaines parties de l'événement. Vos choix dans ce formulaire déterminent l'utilisation de votre photo, de votre matériel et de votre résumé."],
      ["Frais", "ONGIA ne couvre que les frais approuvés dans votre entente de conférencier finale. Les demandes de remboursement de repas exigent un reçu ou une déclaration signée et suivent la directive du Conseil du Trésor du Canada."],
      ["Changements", "ONGIA peut modifier l'horaire ou le format de l'événement et vous en avisera à l'avance. ONGIA peut retirer une invitation si ces conditions ne sont pas respectées."],
    ],
  },
};

/**
 * The Volunteer Terms: what a volunteer signs before the event (Andrew, 18 Oct 2026:
 * represent ONGIA professionally, represent your own organization, behaviour and
 * language, and the same good-standing / no-investigation statement the presenters
 * make). One copy in both languages, like the Presenter Terms: the form shows it
 * in full and the filed PDF prints the English, so what they read is what is on file.
 * Change the wording here and bump VERSION; each agreement records the version it
 * was signed under.
 */
export const VOLUNTEER_TERMS_VERSION = 1;

export const VOLUNTEER_TERMS = {
  en: {
    title: "ONGIA Volunteer Terms",
    intro: "By volunteering at an ONGIA event, you agree to the following.",
    items: [
      ["Professional conduct", "You are representing ONGIA. Stay professional at all times, before, during and after the event, in person and online, including at any social event. Treat attendees, presenters, other volunteers, venue staff and ONGIA staff with courtesy and respect."],
      ["Representing your organization", "You also represent your own organization. You are responsible for having its approval to volunteer, and for making sure your role does not conflict with your duties there. Make clear when you are giving your own views rather than speaking for ONGIA or your organization."],
      ["Appropriate behaviour and language", "Use respectful language at all times. Harassment, discrimination, and offensive, sexual or demeaning comments, jokes or images are not acceptable, in person, in messages or on social media."],
      ["Dress", "Dress as your event lead directs. Business casual is the minimum unless you are told otherwise."],
      ["Confidentiality", "You may see or hear sensitive information, such as attendee lists, presenters' materials and what is said in sessions. Keep it confidential. Do not share it, and do not ask anyone for confidential information."],
      ["Photos and social media", "Do not post photos, video or recordings of sessions, presentation materials or attendees on social media without ONGIA's approval."],
      ["Following direction", "Follow the instructions of the event lead and ONGIA staff. Arrive on time for your shifts, and tell ONGIA right away if you can no longer attend or your plans change."],
      ["Safety and concerns", "Tell the event lead right away about any safety concern, incident or complaint. If someone is in danger, call 911 first."],
      ["Expenses", "This is a volunteer role and is unpaid. ONGIA covers only the costs it has confirmed to you in writing before the event."],
      ["Changes and ending your role", "ONGIA may change your tasks or schedule and will tell you in advance. ONGIA may end your volunteer role at any time, including if these terms are not followed."],
    ],
    // The two statements the volunteer ticks, kept here so the form and the PDF cannot drift apart.
    termsBox: "I have read and agree to the ONGIA Volunteer Terms above.",
    standing: "I confirm that I am currently in good standing with my agency or organization, and that I am not currently subject to any formal investigation or disciplinary proceedings.",
  },
  fr: {
    title: "Conditions applicables aux bénévoles d'ONGIA",
    intro: "En faisant du bénévolat lors d'un événement d'ONGIA, vous acceptez ce qui suit.",
    items: [
      ["Conduite professionnelle", "Vous représentez ONGIA. Restez professionnel en tout temps, avant, pendant et après l'événement, en personne et en ligne, y compris lors des activités sociales. Traitez les participants, les conférenciers, les autres bénévoles, le personnel du lieu et le personnel d'ONGIA avec courtoisie et respect."],
      ["Représenter votre organisation", "Vous représentez aussi votre propre organisation. Il vous incombe d'obtenir son approbation pour faire du bénévolat et de vous assurer que votre rôle n'entre pas en conflit avec vos fonctions. Précisez lorsque vous exprimez votre opinion personnelle plutôt que celle d'ONGIA ou de votre organisation."],
      ["Comportement et langage appropriés", "Employez en tout temps un langage respectueux. Le harcèlement, la discrimination ainsi que les commentaires, blagues ou images offensants, sexuels ou dégradants sont inacceptables, en personne, dans les messages ou sur les médias sociaux."],
      ["Tenue vestimentaire", "Habillez-vous selon les directives de la personne responsable de l'événement. La tenue d'affaires décontractée est le minimum, sauf indication contraire."],
      ["Confidentialité", "Vous pourriez voir ou entendre des renseignements de nature délicate, comme les listes de participants, le matériel des conférenciers et ce qui se dit pendant les séances. Gardez-les confidentiels. Ne les communiquez pas et ne demandez à personne de renseignements confidentiels."],
      ["Photos et médias sociaux", "Ne publiez pas de photos, de vidéos ou d'enregistrements des séances, du matériel de présentation ou des participants sur les médias sociaux sans l'approbation d'ONGIA."],
      ["Respect des directives", "Suivez les directives de la personne responsable de l'événement et du personnel d'ONGIA. Soyez à l'heure pour vos quarts et avisez ONGIA sans tarder si vous ne pouvez plus être présent ou si vos plans changent."],
      ["Sécurité et préoccupations", "Signalez sans tarder à la personne responsable de l'événement toute préoccupation de sécurité, tout incident ou toute plainte. Si une personne est en danger, composez d'abord le 911."],
      ["Frais", "Il s'agit d'un rôle bénévole non rémunéré. ONGIA ne couvre que les frais qu'elle vous a confirmés par écrit avant l'événement."],
      ["Changements et fin de votre rôle", "ONGIA peut modifier vos tâches ou votre horaire et vous en avisera à l'avance. ONGIA peut mettre fin à votre rôle de bénévole en tout temps, notamment si ces conditions ne sont pas respectées."],
    ],
    termsBox: "J'ai lu les conditions applicables aux bénévoles d'ONGIA ci-dessus et je les accepte.",
    standing: "Je confirme que je suis actuellement en règle auprès de mon organisme ou de mon organisation et que je ne fais actuellement l'objet d'aucune enquête officielle ni d'aucune procédure disciplinaire.",
  },
};
