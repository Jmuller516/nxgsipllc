/* English / Spanish text for the customer pages (booking, party page, invitation, waiver, calendar, chat).
 * NXI18N.lang       'en' or 'es' (from ?lang=, then the family's last choice, then the browser)
 * NXI18N.t(key, …)  a phrase; {0} {1} … are filled in from the extra arguments
 * NXI18N.apply()    fills elements marked data-i18n="key" (text) / data-i18n-ph="key" (placeholder)
 * NXI18N.toggle(el) adds the English / Español switch
 */
(function () {
  var D = {
    en: {
      langSwitch: 'Español', langName: 'English',
      // home page
      homeTitle: 'Sports, events and parties in {0}', heroSports: 'Sports', heroEvents: 'Events', heroParties: 'Parties',
      heroSportsLine: 'Turf, courts and a training room for teams, clinics and private sessions.', heroEventsLine: 'Company outings, adult nights, senior groups and team days, run start to finish.', heroPartiesLine: 'Birthday parties with field games, a video game room and a party room, booked online in minutes.',
      bookParty: 'Book a party', seeDates: 'See open dates', requestQuote: 'Request a quote', askField: 'Ask about field time', renderingsNote: 'Renderings of the new facility',
      partiesH: 'Birthday parties kids talk about for weeks', partiesP: 'Every party gets field play, the video game room and the party room for food, cake and presents. Pick a package, pick a time, and you’re done.', fromPrice: 'from {0}', includesN: 'Includes {0} kids',
      eventsH: 'Your group, our field', eventsP: 'Company outings, trade shows, card shows, tournaments and fundraisers. Tell us the date and the group size and we’ll send options with pricing within one business day.',
      eventsList: ['Company outings and team-building', 'Sports expos and trade shows', 'Baseball card and collectibles shows', 'Tournaments, fundraisers and league nights'], eventsMore: 'See all event types',
      sportsH: 'Built for training', sportsP: 'A full turf field, indoor courts and a turf training room. Coaches and teams can ask about field time, clinics and private sessions.',
      sportsList: ['Turf field', 'Indoor courts', 'Turf training room', 'Video game room'],
      giftCards: 'Gift cards', partners: 'Partners & sponsors', calendar: 'Availability calendar', visit: 'Visit us',
      // booking page
      bookTitle: 'Book your event', seeCalendar: 'See the availability calendar →', demoBanner: 'Demo mode: payments are simulated until Stripe is connected.',
      cancelBanner: 'Payment was cancelled. Your time is held briefly; you can try again below.', tabParty: 'Kids birthday party', tabGroup: 'Group & corporate',
      howItGoes: 'How the party goes', step1: '1. Choose a package', howManyKids: 'How many kids?', themeLabel: 'Sport theme', themeLater: '(you can change it later)', chooseLater: 'Choose later',
      step2: '2. Pick a date & time', partyDate: 'Party date', startTime: 'Start time', step3: '3. Extras', optional: '(optional)', step4: '4. Your details',
      childName: "Birthday child's name", turning: 'Turning', yourName: 'Your name', email: 'Email', phone: 'Phone', anything: 'Anything we should know?', anythingHint: '(allergies, theme…)',
      smsOptIn: 'Text me reminders about my party (confirmation, balance due, day-before). Msg & data rates may apply. Reply STOP to opt out.',
      marketingOptIn: 'Send me camps, clinics and party offers (unsubscribe anytime).',
      summary: 'Summary', chooseToPrice: 'Choose a package and date to see your price.', haveCode: 'Have a gift card or referral code?', enterCode: 'Enter code', apply: 'Apply',
      continuePay: 'Continue to payment', pickTime: 'Pick a start time', payReserve: 'Pay {0} and reserve', reserveGift: 'Reserve with gift card', reserving: 'Reserving…',
      subtotal: 'Subtotal', total: 'Total', deposit: '{0}% deposit', payment: 'Payment', giftCard: 'Gift card {0}', dueToday: 'Due today', dueTodayFull: 'Due today (paid in full)', dueTodayDeposit: 'Due today ({0}% deposit)',
      balanceDueBy: 'Balance due by {0}', policy: 'A {0}% non-refundable deposit reserves your party. The balance is due {1} days before. Parties booked within {1} days are paid in full.',
      changePolicy: 'Plans change? You can move your party once online up to {0} days before.',
      includesKids: 'Includes {0} kids; {1} per extra child (max {2}).', partiesRun: 'Parties run {0}.', and: 'and',
      days: ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'],
      noParties: "We don't run parties that day — please pick another date.", dayFull: 'That day is fully booked.', to: 'to', taken: 'Taken',
      lenMinutes: '{0} minutes', lenHours: '{0} hours', each: 'each', per: 'per', min: 'min {0}', orderAhead: 'order {0} ahead', weeks: '{0} weeks', daysN: '{0} days',
      notInTime: 'Not enough time before this date', needsRush: 'Needs Rush shirt printing for this date', onlyWithin: 'Only for parties less than {0} days away',
      whatsIncluded: "What's included", whatsIncludedLink: "What's included ›", close: 'Close', onePerParty: 'one per party', minimum: 'minimum {0}',
      shirtsIncluded: 'Every child already gets a shirt with {0}. Add extras here for siblings or parents.', selected: '· {0} selected',
      referralApplied: 'Referral code applied: {0} off.', giftApplied: 'Gift card applied. {0} will stay on the card.', fillContact: 'Please fill in your name, email and phone.',
      comparePackages: 'Compare packages', yes: '✓', no: '—',
      upgradeTitle: 'Make it bigger?', upgradeLine: 'Upgrade to {0} for {1} more: {2}.', upgradeBtn: 'Upgrade to {0}', upgradedNote: 'Upgraded to {0}.',
      waitTitle: 'Want this day anyway?', waitIntro: "Join the waitlist for {0}. If a time opens up, we'll email you right away (first to book gets it).",
      waitJoin: 'Join the waitlist', waitDone: "You're on the waitlist for {0}. We'll email you if a time opens.", waitSms: 'Text me too', waitAnyTime: 'Want a time that’s taken? Join the waitlist',
      tourBtn: '▶ Take the video tour', faqTitle: 'Questions parents ask', instaTitle: 'Follow us on Instagram', rendering: 'Rendering', priceUp: '+{0}', priceDown: '−{0}',
      inquiryTitle: 'Tell us about your event', inquiryIntro: "Corporate outings, adult nights, senior groups and team skill building. We'll get back to you with a quote.",
      eventType: 'Type of event', orgTeam: 'Organization / team', prefDate: 'Preferred date', endDate: 'Last day (multi-day events)', vendorCount: 'Vendors / tables needed', groupSize: 'Group size', details: 'Details', partnerProducts: 'Add partner products to your quote',
      sendRequest: 'Send request', thanksGot: 'Thanks — we got it!', reachOut: "We'll reach out within one business day.", location: 'Location',
      courtsCaption: 'Courts & turf for team events', trainingCaption: 'Turf field for skill sessions',
      // party page
      loadingBooking: 'Loading your booking…', notFound: 'Booking not found', notFoundHint: 'Please use the link from your confirmation email, or contact us.',
      st_pending: 'Waiting for payment. Your time is held for a short while.', st_confirmed: 'Confirmed. Deposit received.', st_paid: 'Confirmed. Paid in full.', st_cancelled: 'Cancelled.', st_expired: 'This hold expired before payment. Please book again or contact us.',
      paymentReceived: 'Payment received. Thank you!', bookingN: 'Booking {0}', partyOf: "{0}’s party", yourParty: 'Your party',
      where: 'Where', date: 'Date', time: 'Time', package: 'Package', kids: 'Kids', theme: 'Theme', schedule: 'Schedule',
      partyDetails: 'Party details', complete: 'Complete ✓', toGo: '{0} to go', stillNeeded: 'Still needed: {0}.', chooseTheme: 'Choose a theme…', exactSpelling: '(exact spelling)',
      jersey: 'Jersey number', jerseyHint: '(for personalized items)', shirtSizes: 'Shirt sizes', photo: 'Photo of the birthday child', photoHint: '(for the scoreboard, poster or favor boxes)',
      allergies: 'Food allergies in the group', allergiesHint: '(write “none” if none)', anythingElse: 'Anything else?', saveDetails: 'Save details', saving: 'Saving…', saved: 'Saved.', savedAll: 'Saved. Everything we need is in!',
      invitesTitle: 'Invitations & waivers', waiversOf: '{0} of {1} waivers', inviteIntro: 'Send this link to your guests. They RSVP, list allergies, and sign the waiver online, so check-in is quick.',
      copy: 'Copy', copied: 'Copied ✓', share: 'Share…', previewInvite: 'Preview invitation', comingLine: '<b>{0}</b> coming · {1} can’t make it · {2} kids booked',
      moreGuests: 'More guests than booked kids. Extra kids are {0} each, settled at check-in.', needsWaiverToo: '{0} needs a waiver too.', signNow: 'Sign it now',
      guest: 'Guest', reply: 'Reply', waiver: 'Waiver', comingYes: 'Coming', comingNo: 'Can’t come', signed: '✓ Signed', notYet: 'Not yet', noReplies: 'No replies yet.',
      receipt: 'Receipt', balance: 'Balance', payBalance: 'Pay balance {0}', useGift: 'Use a gift card or party credit', giftPlaceholder: 'Code, e.g. NXGC-ABCD-EFGH',
      depositNonRefundable: 'The {0}% deposit is non-refundable.', refundNote: 'Refund of {0} on its way.',
      shareTitle: 'Share the fun, earn party credit', shareIntro: 'Give your code to another family. They get <b>{0} off</b> their party, and you get <b>{1}</b> in party credit when they book.',
      todoTitle: 'Your party checklist', todoAllSet: 'You’re all set. See you at the party!', todoPay: 'Pay your balance of {0} (due {1})', todoPaid: 'Paid in full', todoDetails: 'Finish your party details: {0}', todoDetailsDone: 'Party details complete',
      todoInvite: 'Send your invitation link to the guests', todoInviteDone: '{0} guests have replied', todoWaivers: '{0} guest(s) still need to sign the waiver', todoWaiversDone: 'Waivers signed', todoReview: 'Tell us how the party went', todoOpen: 'Open',
      getTitle: 'What you’re getting', getAddons: 'Your add-ons', getNone: 'No add-ons yet. You can add them from the booking page or call us.', codeTitle: 'Your party page code', codeHint: 'Open this page anytime at {0} with your email and this code.',
      reviewMin: 'At least {0} characters, so other families get a real picture.', reviewCount: '{0} of {1} characters', reviewPickStar: 'Choose 1 to 5 stars.', reviewRated: '{0} of 5 stars',
      beforeTitle: 'Before you come', beforeArrive: 'Please arrive 10–15 minutes before your {0} start.', beforePass: 'Show your check-in pass (the QR code further down this page) at the front desk.', beforeWaivers: 'Every child needs a signed waiver. Guests can sign from your invitation link.', directions: 'Get directions', calGoogle: 'Add to Google Calendar', calApple: 'Apple / Outlook calendar',
      howWas: 'How was the party?', thanksReview: 'Thanks for your review! You gave us {0}.', tellUs: 'Tell us about it', nameToShow: 'Name to show', nameEg: '(e.g. “Dana R.”)',
      mayShare: '{0} may share my review on its website.', sendReview: 'Send review', thankYou: 'Thank you!', appreciate: 'We really appreciate it.', alsoGoogle: 'Would you also share it on Google? It helps other families find us.', reviewGoogle: 'Review us on Google',
      questions: 'Questions? Email {0}{1}. Keep this page’s link. It’s your receipt and party hub.', orCall: ' or call {0}',
      inviteShareText: "You're invited to {0} party at {1}! RSVP and sign the waiver here:", ours: 'our',
      videoTitle: 'Your highlight video', watchVideo: 'Watch the video',
      changeTitle: 'Change or cancel', moveTitle: 'Move to another date', moveIntro: 'Pick a new date and time. Your package, guests and extras come along.', newDate: 'New date',
      moveBtn: 'Move my party to {0}', moving: 'Moving…', moved: 'Done! Your party is now on {0} at {1}.', cantMove: '{0}',
      cancelTitle: 'Cancel the party', cancelRefund: 'If you cancel now, we refund {0} (everything except the {1} deposit).', cancelNoRefund: "Parties cancelled less than {0} days before aren't refunded, and the deposit is non-refundable.",
      cancelType: 'Type CANCEL to confirm', cancelBtn: 'Cancel my party', cancelling: 'Cancelling…', reasonOpt: 'Reason (optional)',
      passTitle: 'Check-in pass', passIntro: 'Show this at the front desk for a fast check-in.', passBday: 'For {0}',
      // invitation
      loadingInvite: 'Loading invitation…', inviteNotFound: 'Invitation not found', inviteNotFoundHint: 'Please check the link you were sent.', youreInvited: 'You’re invited!',
      birthdayOf: "{0}’s {1}Birthday", aParty: 'A birthday party', notActive: 'This party is no longer active. Please check with the host.', host: 'Host', whatWeDo: 'What we’ll do',
      addCal: 'Add to Google Calendar', sneakers: 'Please wear sneakers. Every child who plays needs a signed waiver, so sign it below and check-in will be quick.',
      rsvp: 'RSVP', youReplied: 'You replied “{0}” for {1}. You can change it below.', weBeThere: '🎉 We’ll be there', cantMake: 'Can’t make it', yourChild: 'Your child’s name', phoneOpt: 'Phone',
      allergiesOr: 'Food allergies', allergiesOrHint: '(or “none”)', sendRsvp: 'Send RSVP', thanksLetting: 'Thanks for letting us know', missChild: 'We’ll miss {0}! You can change your reply anytime with this link.',
      seeYou: 'See you there! 🎉', onList: '{0} is on the guest list.', waiverOnFile: '✓ We already have a signed waiver for {0}. Nothing else to do!', lastStep: 'One last step: sign the waiver',
      aboutMinute: 'It takes about a minute and is good for a year.', allSet: 'All set!', waiverSigned: '✓ Waiver signed for {0}. See you at the party!',
      // waiver
      loadingWaiver: 'Loading waiver…', sampleWaiver: 'Sample waiver text. It must be replaced with an attorney-approved waiver before real use.',
      childFull: 'Child’s full name', birthDate: 'Child’s birth date', guardianFull: 'Parent/guardian full name', emergency: 'Emergency contact', emergencyHint: '(name & phone)',
      medical: 'Allergies or medical notes', agree: 'I am the parent or legal guardian and I have read and agree to the waiver above.', signBelow: 'Sign below with your finger or mouse', clear: 'Clear',
      typeName: 'Type your full name to confirm', signWaiver: 'Sign waiver', signing: 'Signing…', validFor: 'Valid for {0} months. Signed {1} · version {2}', waiverNoLoad: 'The waiver could not be loaded. Please sign at the front desk.',
      waiverEnglishOnly: '', saveFailed: 'Could not save the waiver.',
      // calendar
      calTitle: 'Party availability', live: 'Live — updates automatically', liveUpdated: 'Live — updated {0}', open: 'Open', fewLeft: 'Few left', booked: 'Booked', closed: 'Closed', callUs: 'Call us', nOpen: '{0} open',
      fewTimes: 'Few times left', tapTime: 'Tap a start time to book. Times shown are for 2-hour parties; the 90-minute Rookie Party fits too.', dayJustFilled: 'This day just filled up — please choose another.',
      groupEvent: "Planning a corporate, adult, senior or team event? <a href=\"{0}\">Send us a request</a> and we'll get back to you with options.", dows: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      // chat
      chatPlan: 'Plan a party', chatWith: 'Chat with {0}', chatAi: 'Virtual assistant · AI', chatType: 'Type a message…', chatSend: 'Send', chatClose: 'Close chat',
      chatNote: 'You’re chatting with {0}, {1}’s AI assistant. A team member can follow up anytime; just ask.', chatHi: 'Hi! I’m {0} 👋 I can check open dates, answer questions about parties at {1}, and book your party right here. What are you celebrating?',
      chatChips: ['Book a birthday party', 'What are the prices?', 'Is this Saturday open?', 'Corporate or team event'], chatSecure: 'Secure checkout · booking {0}', chatDown: 'Chat is not available right now. Please use the booking form.', chatError: 'Sorry, I couldn’t reach the server. Please try again.',
    },
    es: {
      langSwitch: 'English', langName: 'Español',
      homeTitle: 'Deportes, eventos y fiestas en {0}', heroSports: 'Deportes', heroEvents: 'Eventos', heroParties: 'Fiestas',
      heroSportsLine: 'Césped, canchas y una sala de entrenamiento para equipos, clínicas y sesiones privadas.', heroEventsLine: 'Salidas de empresa, noches para adultos, grupos de personas mayores y días de equipo, organizados de principio a fin.', heroPartiesLine: 'Fiestas de cumpleaños con juegos en la cancha, salón de videojuegos y salón de fiestas, reservadas en línea en minutos.',
      bookParty: 'Reservar una fiesta', seeDates: 'Ver fechas libres', requestQuote: 'Pedir una cotización', askField: 'Preguntar por la cancha', renderingsNote: 'Representaciones de la nueva instalación',
      partiesH: 'Fiestas de las que los niños hablan por semanas', partiesP: 'Cada fiesta incluye juego en la cancha, el salón de videojuegos y el salón de fiestas para comida, pastel y regalos. Elija un paquete, elija una hora y listo.', fromPrice: 'desde {0}', includesN: 'Incluye {0} niños',
      eventsH: 'Su grupo, nuestra cancha', eventsP: 'Team-building de empresas, noches de liga para adultos, grupos de personas mayores y días de habilidades para equipos. Díganos la fecha y el tamaño del grupo y le enviaremos opciones con precios en un día hábil.',
      eventsList: ['Salidas de empresa y trabajo en equipo', 'Expos deportivas y ferias comerciales', 'Exhibiciones de tarjetas de béisbol y coleccionables', 'Torneos, recaudaciones y noches de liga'], eventsMore: 'Ver todos los tipos de evento',
      sportsH: 'Hecho para entrenar', sportsP: 'Una cancha de césped completa, canchas cubiertas y una sala de entrenamiento con césped. Entrenadores y equipos pueden preguntar por horarios de cancha, clínicas y sesiones privadas.',
      sportsList: ['Cancha de césped', 'Canchas cubiertas', 'Sala de entrenamiento', 'Salón de videojuegos'],
      giftCards: 'Tarjetas de regalo', partners: 'Socios y patrocinadores', calendar: 'Calendario de disponibilidad', visit: 'Visítenos',
      bookTitle: 'Reserve su evento', seeCalendar: 'Ver el calendario de disponibilidad →', demoBanner: 'Modo de demostración: los pagos son simulados hasta conectar Stripe.',
      cancelBanner: 'Se canceló el pago. Su horario queda reservado por un rato; puede intentarlo de nuevo abajo.', tabParty: 'Fiesta de cumpleaños infantil', tabGroup: 'Grupos y empresas',
      howItGoes: 'Cómo es la fiesta', step1: '1. Elija un paquete', howManyKids: '¿Cuántos niños?', themeLabel: 'Tema deportivo', themeLater: '(puede cambiarlo después)', chooseLater: 'Elegir después',
      step2: '2. Elija fecha y hora', partyDate: 'Fecha de la fiesta', startTime: 'Hora de inicio', step3: '3. Extras', optional: '(opcional)', step4: '4. Sus datos',
      childName: 'Nombre del cumpleañero', turning: 'Cumple', yourName: 'Su nombre', email: 'Correo electrónico', phone: 'Teléfono', anything: '¿Algo que debamos saber?', anythingHint: '(alergias, tema…)',
      smsOptIn: 'Envíenme recordatorios de mi fiesta por mensaje de texto (confirmación, saldo, día anterior). Pueden aplicar tarifas. Responda STOP para no recibir más.',
      marketingOptIn: 'Envíenme información de campamentos, clínicas y ofertas de fiestas (puede darse de baja cuando quiera).',
      summary: 'Resumen', chooseToPrice: 'Elija un paquete y una fecha para ver su precio.', haveCode: '¿Tiene una tarjeta de regalo o un código de referido?', enterCode: 'Escriba el código', apply: 'Aplicar',
      continuePay: 'Continuar al pago', pickTime: 'Elija una hora de inicio', payReserve: 'Pagar {0} y reservar', reserveGift: 'Reservar con tarjeta de regalo', reserving: 'Reservando…',
      subtotal: 'Subtotal', total: 'Total', deposit: 'Depósito del {0}%', payment: 'Pago', giftCard: 'Tarjeta de regalo {0}', dueToday: 'A pagar hoy', dueTodayFull: 'A pagar hoy (pago completo)', dueTodayDeposit: 'A pagar hoy (depósito del {0}%)',
      balanceDueBy: 'Saldo a pagar antes del {0}', policy: 'Un depósito no reembolsable del {0}% reserva su fiesta. El saldo se paga {1} días antes. Las fiestas reservadas con menos de {1} días se pagan completas.',
      changePolicy: '¿Cambio de planes? Puede mover su fiesta una vez en línea hasta {0} días antes.',
      includesKids: 'Incluye {0} niños; {1} por cada niño adicional (máximo {2}).', partiesRun: 'Hay fiestas los {0}.', and: 'y',
      days: ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'],
      noParties: 'Ese día no hay fiestas. Por favor elija otra fecha.', dayFull: 'Ese día está completo.', to: 'a', taken: 'Ocupado',
      lenMinutes: '{0} minutos', lenHours: '{0} horas', each: 'c/u', per: 'por', min: 'mín. {0}', orderAhead: 'pedir con {0} de anticipación', weeks: '{0} semanas', daysN: '{0} días',
      notInTime: 'No hay tiempo suficiente antes de esta fecha', needsRush: 'Para esta fecha necesita Impresión urgente de camisetas', onlyWithin: 'Solo para fiestas en menos de {0} días',
      whatsIncluded: 'Qué incluye', whatsIncludedLink: 'Qué incluye ›', close: 'Cerrar', onePerParty: 'uno por fiesta', minimum: 'mínimo {0}',
      shirtsIncluded: 'Cada niño ya recibe una camiseta con la {0}. Agregue más aquí para hermanos o padres.', selected: '· {0} elegidos',
      referralApplied: 'Código de referido aplicado: {0} de descuento.', giftApplied: 'Tarjeta de regalo aplicada. Quedarán {0} en la tarjeta.', fillContact: 'Por favor escriba su nombre, correo y teléfono.',
      comparePackages: 'Comparar paquetes', yes: '✓', no: '—',
      upgradeTitle: '¿La hacemos más grande?', upgradeLine: 'Cambie a {0} por {1} más: {2}.', upgradeBtn: 'Cambiar a {0}', upgradedNote: 'Cambió a {0}.',
      waitTitle: '¿Quiere ese día de todas formas?', waitIntro: 'Anótese en la lista de espera para el {0}. Si se abre un horario, le escribimos enseguida (el primero que reserva se lo queda).',
      waitJoin: 'Anotarme en la lista de espera', waitDone: 'Está en la lista de espera para el {0}. Le escribiremos si se abre un horario.', waitSms: 'Avísenme también por mensaje de texto', waitAnyTime: '¿Quiere un horario ocupado? Anótese en la lista de espera',
      tourBtn: '▶ Ver el recorrido en video', faqTitle: 'Preguntas frecuentes', instaTitle: 'Síganos en Instagram', rendering: 'Representación', priceUp: '+{0}', priceDown: '−{0}',
      inquiryTitle: 'Cuéntenos de su evento', inquiryIntro: 'Salidas de empresa, noches para adultos, grupos de personas mayores y entrenamiento de equipos. Le enviaremos una cotización.',
      eventType: 'Tipo de evento', orgTeam: 'Organización / equipo', prefDate: 'Fecha preferida', endDate: 'Último día (eventos de varios días)', vendorCount: 'Vendedores / mesas necesarias', groupSize: 'Tamaño del grupo', details: 'Detalles', partnerProducts: 'Agregar productos de socios a su cotización',
      sendRequest: 'Enviar solicitud', thanksGot: '¡Gracias, la recibimos!', reachOut: 'Le contestaremos en un día hábil.', location: 'Sede',
      courtsCaption: 'Canchas y césped para eventos de equipo', trainingCaption: 'Césped para sesiones de habilidades',
      loadingBooking: 'Cargando su reserva…', notFound: 'No encontramos la reserva', notFoundHint: 'Use el enlace de su correo de confirmación o comuníquese con nosotros.',
      st_pending: 'Esperando el pago. Su horario queda reservado por un rato.', st_confirmed: 'Confirmada. Recibimos el depósito.', st_paid: 'Confirmada. Pagada por completo.', st_cancelled: 'Cancelada.', st_expired: 'La reserva temporal venció antes del pago. Reserve de nuevo o comuníquese con nosotros.',
      paymentReceived: 'Pago recibido. ¡Gracias!', bookingN: 'Reserva {0}', partyOf: 'Fiesta de {0}', yourParty: 'Su fiesta',
      where: 'Dónde', date: 'Fecha', time: 'Hora', package: 'Paquete', kids: 'Niños', theme: 'Tema', schedule: 'Horario',
      partyDetails: 'Detalles de la fiesta', complete: 'Completo ✓', toGo: 'Faltan {0}', stillNeeded: 'Falta: {0}.', chooseTheme: 'Elija un tema…', exactSpelling: '(escrito exacto)',
      jersey: 'Número de camiseta', jerseyHint: '(para los artículos personalizados)', shirtSizes: 'Tallas de camisetas', photo: 'Foto del cumpleañero', photoHint: '(para el marcador, el póster o las cajas de recuerdo)',
      allergies: 'Alergias alimentarias en el grupo', allergiesHint: '(escriba “ninguna” si no hay)', anythingElse: '¿Algo más?', saveDetails: 'Guardar detalles', saving: 'Guardando…', saved: 'Guardado.', savedAll: 'Guardado. ¡Ya tenemos todo lo que necesitamos!',
      invitesTitle: 'Invitaciones y exenciones', waiversOf: '{0} de {1} exenciones', inviteIntro: 'Envíe este enlace a sus invitados. Confirman asistencia, indican alergias y firman la exención en línea, así la llegada es rápida.',
      copy: 'Copiar', copied: 'Copiado ✓', share: 'Compartir…', previewInvite: 'Ver invitación', comingLine: '<b>{0}</b> vienen · {1} no pueden · {2} niños reservados',
      moreGuests: 'Hay más invitados que niños reservados. Cada niño adicional cuesta {0} y se paga al llegar.', needsWaiverToo: '{0} también necesita una exención.', signNow: 'Firmarla ahora',
      guest: 'Invitado', reply: 'Respuesta', waiver: 'Exención', comingYes: 'Viene', comingNo: 'No viene', signed: '✓ Firmada', notYet: 'Todavía no', noReplies: 'Todavía no hay respuestas.',
      receipt: 'Recibo', balance: 'Saldo', payBalance: 'Pagar saldo {0}', useGift: 'Usar tarjeta de regalo o crédito', giftPlaceholder: 'Código, p. ej. NXGC-ABCD-EFGH',
      depositNonRefundable: 'El depósito del {0}% no es reembolsable.', refundNote: 'Reembolso de {0} en camino.',
      shareTitle: 'Comparta la diversión y gane crédito', shareIntro: 'Dele su código a otra familia. Ellos reciben <b>{0} de descuento</b> en su fiesta, y usted recibe <b>{1}</b> en crédito cuando reserven.',
      todoTitle: 'La lista de su fiesta', todoAllSet: '¡Todo listo! Nos vemos en la fiesta.', todoPay: 'Pague su saldo de {0} (vence el {1})', todoPaid: 'Pagada por completo', todoDetails: 'Termine los datos de la fiesta: {0}', todoDetailsDone: 'Datos de la fiesta completos',
      todoInvite: 'Envíe el enlace de invitación a los invitados', todoInviteDone: '{0} invitados ya respondieron', todoWaivers: 'Faltan {0} invitado(s) por firmar la exención', todoWaiversDone: 'Exenciones firmadas', todoReview: 'Cuéntenos cómo estuvo la fiesta', todoOpen: 'Abrir',
      getTitle: 'Lo que incluye su fiesta', getAddons: 'Sus extras', getNone: 'Aún no hay extras. Puede agregarlos desde la página de reserva o llamarnos.', codeTitle: 'El código de su página', codeHint: 'Abra esta página cuando quiera en {0} con su correo y este código.',
      reviewMin: 'Al menos {0} caracteres, para que otras familias vean un panorama real.', reviewCount: '{0} de {1} caracteres', reviewPickStar: 'Elija de 1 a 5 estrellas.', reviewRated: '{0} de 5 estrellas',
      beforeTitle: 'Antes de venir', beforeArrive: 'Por favor llegue 10–15 minutos antes de las {0}.', beforePass: 'Muestre su pase de entrada (el código QR más abajo en esta página) en la recepción.', beforeWaivers: 'Cada niño necesita una exención firmada. Los invitados pueden firmar desde su enlace de invitación.', directions: 'Cómo llegar', calGoogle: 'Agregar a Google Calendar', calApple: 'Calendario de Apple / Outlook',
      howWas: '¿Qué tal estuvo la fiesta?', thanksReview: '¡Gracias por su reseña! Nos dio {0}.', tellUs: 'Cuéntenos', nameToShow: 'Nombre a mostrar', nameEg: '(p. ej. “Dana R.”)',
      mayShare: '{0} puede compartir mi reseña en su sitio web.', sendReview: 'Enviar reseña', thankYou: '¡Gracias!', appreciate: 'Se lo agradecemos mucho.', alsoGoogle: '¿La compartiría también en Google? Ayuda a otras familias a encontrarnos.', reviewGoogle: 'Dejar reseña en Google',
      questions: '¿Preguntas? Escriba a {0}{1}. Guarde el enlace de esta página: es su recibo y el centro de su fiesta.', orCall: ' o llame al {0}',
      inviteShareText: '¡Estás invitado a la fiesta de {0} en {1}! Confirma y firma la exención aquí:', ours: 'nuestra',
      videoTitle: 'Su video de los mejores momentos', watchVideo: 'Ver el video',
      changeTitle: 'Cambiar o cancelar', moveTitle: 'Mover a otra fecha', moveIntro: 'Elija una nueva fecha y hora. Su paquete, invitados y extras se mantienen.', newDate: 'Nueva fecha',
      moveBtn: 'Mover mi fiesta a las {0}', moving: 'Moviendo…', moved: '¡Listo! Su fiesta ahora es el {0} a las {1}.', cantMove: '{0}',
      cancelTitle: 'Cancelar la fiesta', cancelRefund: 'Si cancela ahora, le devolvemos {0} (todo menos el depósito de {1}).', cancelNoRefund: 'Las fiestas canceladas con menos de {0} días no tienen reembolso, y el depósito no es reembolsable.',
      cancelType: 'Escriba CANCEL para confirmar', cancelBtn: 'Cancelar mi fiesta', cancelling: 'Cancelando…', reasonOpt: 'Motivo (opcional)',
      passTitle: 'Pase de entrada', passIntro: 'Muéstrelo en la recepción para entrar rápido.', passBday: 'Para {0}',
      loadingInvite: 'Cargando invitación…', inviteNotFound: 'No encontramos la invitación', inviteNotFoundHint: 'Revise el enlace que le enviaron.', youreInvited: '¡Estás invitado!',
      birthdayOf: 'Cumpleaños {1}de {0}', aParty: 'Una fiesta de cumpleaños', notActive: 'Esta fiesta ya no está activa. Consulte con los anfitriones.', host: 'Anfitrión', whatWeDo: 'Lo que haremos',
      addCal: 'Agregar a Google Calendar', sneakers: 'Por favor usen tenis. Cada niño que juega necesita una exención firmada; fírmela abajo y la llegada será rápida.',
      rsvp: 'Confirmar asistencia', youReplied: 'Respondió “{0}” para {1}. Puede cambiarlo abajo.', weBeThere: '🎉 Ahí estaremos', cantMake: 'No podemos ir', yourChild: 'Nombre de su hijo/a', phoneOpt: 'Teléfono',
      allergiesOr: 'Alergias alimentarias', allergiesOrHint: '(o “ninguna”)', sendRsvp: 'Enviar respuesta', thanksLetting: 'Gracias por avisarnos', missChild: '¡Extrañaremos a {0}! Puede cambiar su respuesta cuando quiera con este enlace.',
      seeYou: '¡Nos vemos allí! 🎉', onList: '{0} está en la lista de invitados.', waiverOnFile: '✓ Ya tenemos una exención firmada para {0}. ¡No tiene que hacer nada más!', lastStep: 'Último paso: firme la exención',
      aboutMinute: 'Toma un minuto y es válida por un año.', allSet: '¡Todo listo!', waiverSigned: '✓ Exención firmada para {0}. ¡Nos vemos en la fiesta!',
      loadingWaiver: 'Cargando la exención…', sampleWaiver: 'Texto de exención de ejemplo. Debe reemplazarse por una exención aprobada por un abogado antes de usarse.',
      childFull: 'Nombre completo del niño/a', birthDate: 'Fecha de nacimiento del niño/a', guardianFull: 'Nombre completo del padre, madre o tutor', emergency: 'Contacto de emergencia', emergencyHint: '(nombre y teléfono)',
      medical: 'Alergias o notas médicas', agree: 'Soy el padre, madre o tutor legal y he leído y acepto la exención de arriba.', signBelow: 'Firme abajo con el dedo o el mouse', clear: 'Borrar',
      typeName: 'Escriba su nombre completo para confirmar', signWaiver: 'Firmar exención', signing: 'Firmando…', validFor: 'Válida por {0} meses. Firmada el {1} · versión {2}', waiverNoLoad: 'No se pudo cargar la exención. Por favor fírmela en la recepción.',
      waiverEnglishOnly: 'La exención legal está en inglés. Si tiene preguntas, pida ayuda en la recepción.', saveFailed: 'No se pudo guardar la exención.',
      calTitle: 'Disponibilidad de fiestas', live: 'En vivo — se actualiza solo', liveUpdated: 'En vivo — actualizado {0}', open: 'Libre', fewLeft: 'Quedan pocos', booked: 'Completo', closed: 'Cerrado', callUs: 'Llámenos', nOpen: '{0} libres',
      fewTimes: 'Quedan pocos horarios', tapTime: 'Toque una hora para reservar. Los horarios son para fiestas de 2 horas; la Fiesta Rookie de 90 minutos también cabe.', dayJustFilled: 'Este día se acaba de llenar. Por favor elija otro.',
      groupEvent: '¿Planea un evento de empresa, adultos, personas mayores o equipo? <a href="{0}">Envíenos una solicitud</a> y le enviaremos opciones.', dows: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
      chatPlan: 'Planear una fiesta', chatWith: 'Chatear con {0}', chatAi: 'Asistente virtual · IA', chatType: 'Escriba un mensaje…', chatSend: 'Enviar', chatClose: 'Cerrar chat',
      chatNote: 'Está chateando con {0}, el asistente de IA de {1}. Alguien del equipo puede comunicarse con usted cuando quiera; solo pídalo.', chatHi: '¡Hola! Soy {0} 👋 Puedo ver fechas libres, contestar preguntas sobre fiestas en {1} y reservar su fiesta aquí mismo. ¿Qué van a celebrar?',
      chatChips: ['Reservar un cumpleaños', '¿Cuánto cuesta?', '¿Hay lugar este sábado?', 'Evento de empresa o equipo'], chatSecure: 'Pago seguro · reserva {0}', chatDown: 'El chat no está disponible ahora. Por favor use el formulario de reserva.', chatError: 'Perdón, no pude conectarme. Intente de nuevo.',
    },
  };

  function pick() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'es' || q === 'en') { try { localStorage.setItem('nxgs-lang', q); } catch (e) {} return q; }
    try { var s = localStorage.getItem('nxgs-lang'); if (s === 'es' || s === 'en') return s; } catch (e) {}
    return /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
  }
  var lang = pick();
  document.documentElement.lang = lang;

  function t(key) {
    var s = (D[lang] && D[lang][key] !== undefined) ? D[lang][key] : D.en[key];
    if (s === undefined) return key;
    if (typeof s !== 'string') return s;
    var args = Array.prototype.slice.call(arguments, 1);
    return s.replace(/\{(\d)\}/g, function (_, i) { return args[i] !== undefined ? args[i] : ''; });
  }
  function apply(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  }
  function setLang(l) {
    try { localStorage.setItem('nxgs-lang', l); } catch (e) {}
    var p = new URLSearchParams(location.search); p.set('lang', l);
    var target = location.pathname + '?' + p.toString() + location.hash;
    location.href = target;
  }
  function toggle(el, onSwitch) {
    if (!el) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lang-switch'; b.textContent = t('langSwitch');
    b.setAttribute('lang', lang === 'es' ? 'en' : 'es');
    b.onclick = function () { var next = lang === 'es' ? 'en' : 'es'; if (onSwitch) onSwitch(next); setLang(next); };
    el.appendChild(b);
  }
  var locale = lang === 'es' ? 'es-US' : 'en-US';
  function date(ymd, opts) { return new Date(ymd + 'T12:00').toLocaleDateString(locale, opts || { weekday: 'long', month: 'long', day: 'numeric' }); }
  window.NXI18N = { lang: lang, t: t, apply: apply, toggle: toggle, date: date, locale: locale, setLang: setLang };
})();
