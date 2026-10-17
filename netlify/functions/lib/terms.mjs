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
