// Spanish (and English) text for customers: package and add-on descriptions, labels, and email wording.
// Staff pages stay in English. Anything without a Spanish version here falls back to English, so a new
// add-on or a price-list edit never breaks a page; add its Spanish text below when you can.

const ES = {
  packages: {
    rookie: {
      name: 'Fiesta Rookie',
      includes: '30 minutos de juego en la cancha (1 deporte)\n30 minutos en el salón de videojuegos\n30 minutos en el salón de fiestas para comida, pastel y regalos\nMesas, sillas y montaje\nLimpieza después de la fiesta',
      description: '90 minutos: 30 min de juego en la cancha (1 deporte), 30 min en el salón de videojuegos, 30 min de comida, pastel y regalos. Hasta 15 niños.',
    },
    allstar: {
      name: 'Fiesta All-Star',
      includes: '2 horas: 60 minutos de juego en la cancha (2 deportes)\n30 minutos en el salón de videojuegos\n30 minutos en el salón de fiestas para comida, pastel y regalos\nPizza de Calabria Pizza para los niños\nBebidas para los niños\nUn anfitrión de NXGS dedicado a su fiesta\nMesas, sillas, montaje y limpieza',
      description: '2 horas: 60 min de juego en la cancha (2 deportes), 30 min en el salón de videojuegos, 30 min de comida, pastel y regalos, más pizza, bebidas y un anfitrión dedicado.',
      upgradePitch: '2 deportes, 2 horas completas, pizza y bebidas, y un anfitrión dedicado',
    },
    mvp: {
      name: 'Fiesta MVP',
      includes: '2 horas: 60 minutos de juego en la cancha (3 deportes)\n30 minutos en el salón de videojuegos\n30 minutos en el salón de fiestas para comida, pastel y regalos\nPizza de Calabria Pizza y bebidas para los niños\nUn anfitrión de NXGS dedicado a su fiesta\nCamiseta estampada para cada niño (estampado de un color por Lifestyles Sports; las tallas se piden después de reservar)\nCamiseta especial para el cumpleañero (a varios colores o con un diseño extra en la espalda)\nLas camisetas tardan 2 semanas en imprimirse: para fiestas en menos de 2 semanas se necesita Impresión urgente de camisetas\nBolsa de regalos para cada niño (contenido por confirmar)\nMesas, sillas, montaje y limpieza',
      description: '2 horas: 60 min de juego en la cancha (3 deportes), 30 min en el salón de videojuegos, 30 min de comida, pastel y regalos, más pizza, bebidas, un anfitrión, una camiseta estampada para cada niño (una especial para el cumpleañero) y bolsas de regalos.',
      upgradePitch: '3 deportes, una camiseta estampada para cada niño y bolsas de regalos',
    },
  },
  phases: {
    'Field play': 'Juego en la cancha',
    'Field play (1 sport)': 'Juego en la cancha (1 deporte)',
    'Field play (2 sports)': 'Juego en la cancha (2 deportes)',
    'Field play (3 sports)': 'Juego en la cancha (3 deportes)',
    'Video game room': 'Salón de videojuegos',
    'Food & cake': 'Comida y pastel',
    'Food, cake & presents': 'Comida, pastel y regalos',
  },
  categories: { food: 'Comida', favors: 'Recuerdos y regalos de fiesta', decor: 'Decoración y extras', fun: 'Entretenimiento y mejoras', partners: 'De nuestros socios' },
  addOns: {
    pizza: ['Pizza adicional', null, 'Una pizza grande de Calabria Pizza en North Bellmore\nUnas 8 porciones\nSe entrega caliente para la hora de comida y pastel'],
    hero: ['Sándwich hero de 3 pies (deli)', null, "Sándwich hero de 3 pies de Amia's Deli en East Meadow\nAlcanza para unas 12–15 personas"],
    bagels: ['Bandeja de bagels', 'Para fiestas por la mañana', 'Una docena de bagels variados, cortados\nQueso crema y mantequilla\nPlatos, servilletas y cuchillos'],
    coffee: ['Café para los padres', 'Caja de café caliente', 'Caja de café caliente, unas 10–12 tazas\nVasos, leche, azúcar y removedores'],
    'favor-box': ['Caja de recuerdo transparente', 'Con foto y dulces envueltos', 'Caja de recuerdo transparente\nFoto del cumpleañero\nLlena de dulces envueltos variados'],
    'locker-box': ['Mini caja de casillero', 'Cartulina impresa, llena', 'Mini caja en forma de casillero de cartulina impresa\nImpresa con el diseño de la fiesta\nLlena de dulces envueltos variados'],
    'jersey-bag': ['Bolsa de dulces tipo camiseta', 'Bolsa de papel personalizada, llena', 'Bolsa de papel impresa como camiseta deportiva\nPersonalizada con el nombre\nLlena de dulces envueltos variados'],
    'water-bottle': ['Botella deportiva', 'Plástico reutilizable, personalizada', 'Botella deportiva de plástico reutilizable\nPersonalizada con un nombre'],
    tumbler: ['Vaso personalizado', 'Acrílico, con tapa y popote', 'Vaso acrílico con tapa y popote\nPersonalizado con un nombre'],
    'mini-ball': ['Mini pelota deportiva', 'De espuma, personalizada', 'Mini pelota deportiva de espuma\nPersonalizada'],
    drawstring: ['Mochila de cordón', 'Bolsa de tela personalizada', 'Mochila de tela con cordón\nPersonalizada con un nombre'],
    medal: ['Medalla MVP', 'Medalla de metal, cinta y etiqueta con nombre', 'Medalla de metal con cinta\nEtiqueta con el nombre'],
    'bag-tag': ['Etiqueta de mochila tipo camiseta', 'Etiqueta acrílica con clip', 'Etiqueta acrílica para mochila con clip\nPersonalizada con nombre y número'],
    wristbands: ['Juego de pulseras', 'Tres pulseras deportivas en un sobre', 'Juego de tres pulseras deportivas\nEmpacadas en un sobre'],
    shirts: ['Camiseta personalizada de fiesta', 'Impresa por Lifestyles Sports', 'Camiseta de fiesta estampada a la medida\nImpresa por Lifestyles Sports en Wantagh\nLas tallas se piden después de reservar'],
    'shirt-rush': ['Impresión urgente de camisetas', 'Para fiestas en menos de 2 semanas', 'Impresión urgente para que las camisetas estén listas para la fiesta\nNecesaria para las camisetas de la Fiesta MVP o las camisetas personalizadas cuando faltan menos de 2 semanas\nConfirmamos la urgencia con nuestra imprenta después de que reserve'],
    'balloon-tower': ['Torre de globos', 'Aprox. 5–6 pies, con adorno deportivo', 'Columna de globos de unos 5–6 pies de alto\nAdorno de pelota deportiva\nLa montamos en NXGS antes de la fiesta'],
    centerpiece: ['Centro de mesa de globos', 'Aprox. 18–24 pulgadas', 'Centro de mesa de globos de unas 18–24 pulgadas de alto\nUno por mesa'],
    poster: ['Póster de atleta', 'Impresión personalizada de 18 × 24 pulg.', 'Póster de atleta personalizado de 18 × 24 pulgadas\nImpresión en papel con el nombre y la foto del niño'],
    'welcome-sign': ['Letrero de bienvenida', 'Cartón espuma personalizado de 18 × 24 pulg.', 'Letrero de bienvenida personalizado de 18 × 24 pulgadas\nCartón espuma, en un caballete a la entrada'],
    backdrop: ['Paquete de fondo para fotos', 'Fondo impreso, guirnalda parcial de globos, montaje', 'Fondo impreso para fotos\nGuirnalda parcial de globos\nMontado por NXGS antes de la fiesta'],
    'cake-topper': ['Adorno para pastel', 'Cartulina en capas personalizada', 'Adorno de cartulina en capas para el pastel\nPersonalizado con el nombre y la edad\nNo incluye el pastel'],
    'cupcake-toppers': ['Adornos para cupcakes', '12 palitos deportivos impresos (no incluye cupcakes)', '12 palitos impresos con tema deportivo para cupcakes\nNo incluye los cupcakes'],
    pennant: ['Banderín de cumpleaños', 'Banderín personalizado tipo fieltro con palo', 'Banderín de cumpleaños tipo fieltro con palo\nPersonalizado con el nombre'],
    'prop-kit': ['Kit de accesorios para fotos', 'Unos 10 accesorios deportivos con palito', 'Unos 10 accesorios con tema deportivo para fotos, con palito'],
    banner: ['Pancarta de cumpleaños del equipo', 'Pancarta de vinil personalizada de 3 × 6 pies', 'Pancarta de vinil personalizada de 3 × 6 pies\nColgada en el salón de fiestas'],
    scoreboard: ['Cumpleaños en el marcador de video', 'El cumpleañero en la pantalla grande', 'Nombre y foto del cumpleañero en el marcador de video\nMensaje de feliz cumpleaños durante el juego en la cancha\nEnvíenos una foto después de reservar'],
    'highlight-video': ['Video de los mejores momentos', 'Un clip corto de la fiesta para guardar y compartir', 'Un clip de 30–60 segundos con lo mejor de la fiesta\nMomentos del juego en la cancha y del cumpleaños\nSe lo enviamos por enlace unos días después de la fiesta'],
    'bounce-house': ['Alquiler de brincolín', 'Inflable para la fiesta', 'Brincolín inflable durante toda la fiesta\nLo entregamos, armamos y desarmamos por usted'],
  },
  units: { each: 'c/u', dozen: 'docena', set: 'juego', party: 'fiesta', box: 'caja', setup: 'montaje', kit: 'kit', hour: 'hora' },
  themes: { soccer: 'Fútbol', baseball: 'Béisbol', softball: 'Softbol', basketball: 'Baloncesto', football: 'Fútbol americano', lacrosse: 'Lacrosse', cheer: 'Porristas', 'all-sports': 'Mezcla de deportes' },
  inquiryTypes: { corporate: 'Salida de empresa / evento corporativo', teambuilding: 'Día de trabajo en equipo', expo: 'Expo deportiva / feria comercial', cardshow: 'Exhibición de tarjetas de béisbol / coleccionables', market: 'Mercado de vendedores / pop-up', tournament: 'Torneo / liga', fundraiser: 'Evento para recaudar fondos', school: 'Escuela, campamento o grupo juvenil', adult: 'Evento para adultos / noche de liga', senior: 'Evento para personas mayores', team: 'Entrenamiento de equipo', other: 'Otra cosa' },
  compareRows: { length: 'Duración de la fiesta', sports: 'Deportes en la cancha', gameRoom: 'Salón de videojuegos', pizza: 'Pizza y bebidas para los niños', host: 'Anfitrión dedicado', shirts: 'Camiseta estampada para cada niño', goodieBags: 'Bolsa de regalos para cada niño' },
  timePricing: { prime: 'Horario estelar (mediodía de fin de semana)', friday: 'Descuento de viernes por la tarde' },
  taxLabel: 'Impuesto de ventas de NY',
  faq: {
    'How long is a party?': '¿Cuánto dura una fiesta?',
    'How many kids can come?': '¿Cuántos niños pueden venir?',
    'How do payments work?': '¿Cómo funcionan los pagos?',
    'Do guests need a waiver?': '¿Los invitados necesitan una exención firmada?',
    'What should kids wear?': '¿Qué deben ponerse los niños?',
    'When should we arrive?': '¿A qué hora debemos llegar?',
    'Can we change or cancel?': '¿Podemos cambiar o cancelar?',
    'Can we bring our own cake and food?': '¿Podemos traer nuestro propio pastel y comida?',
    'Can parents stay and watch?': '¿Los padres pueden quedarse a mirar?',
    'Where do we park?': '¿Dónde nos estacionamos?',
  },
  faqAnswers: {
    'Do guests need a waiver?': 'Sí. Cada niño que juega necesita una exención firmada por su padre, madre o tutor. Los invitados la firman en línea con su enlace de invitación, y es válida por un año.',
    'What should kids wear?': 'Tenis y ropa cómoda para correr.',
    'When should we arrive?': 'Por favor lleguen de 10 a 15 minutos antes de la hora de inicio.',
  },
};

const LANGS = { en: true, es: true };
const lang = (l) => (LANGS[l] ? l : 'en');

// ---------- content ----------
function packageText(p, l) {
  if (lang(l) !== 'es') return p;
  const t = ES.packages[p.id] || {};
  return { ...p, name: t.name || p.name, includes: t.includes || p.includes, description: t.description || p.description, upgradePitch: t.upgradePitch || p.upgradePitch,
    phases: (p.phases || []).map((ph) => ({ ...ph, label: ES.phases[ph.label] || ph.label })) };
}
function addOnText(a, l) {
  if (lang(l) !== 'es' || !ES.addOns[a.id]) return a;
  const [name, detail, includes] = ES.addOns[a.id];
  return { ...a, name: name || a.name, detail: detail || a.detail, includes: includes || a.includes };
}
const phaseLabel = (label, l) => (lang(l) === 'es' ? ES.phases[label] || label : label);
const unitLabel = (u, l) => (lang(l) === 'es' ? ES.units[u] || u : u);

/** The public /api/config payload, in the customer's language. */
function localizeConfig(c, l) {
  if (lang(l) !== 'es') return { ...c, lang: 'en' };
  return {
    ...c,
    lang: 'es',
    packages: c.packages.map((p) => packageText(p, 'es')),
    addOns: c.addOns.map((a) => ({ ...addOnText(a, 'es'), unitLabel: unitLabel(a.unit, 'es') })),
    addOnCategories: c.addOnCategories.map((x) => ({ ...x, name: ES.categories[x.id] || x.name })),
    themes: c.themes.map((t) => ({ ...t, name: ES.themes[t.id] || t.name })),
    inquiryTypes: c.inquiryTypes.map((t) => ({ ...t, name: ES.inquiryTypes[t.id] || t.name })),
    compareRows: (c.compareRows || []).map((r) => ({ ...r, label: ES.compareRows[r.key] || r.label })),
    party: { ...c.party, phases: c.party.phases.map((ph) => ({ ...ph, label: phaseLabel(ph.label, 'es') })) },
    tax: { ...c.tax, label: ES.taxLabel },
  };
}

/** A quote/receipt line's name in the customer's language. */
function lineName(line, l) {
  if (lang(l) !== 'es') return line.name;
  if (line.kind === 'package') return ES.packages[line.id]?.name || line.name;
  if (line.kind === 'addon') return ES.addOns[line.id]?.[0] || line.name;
  if (line.kind === 'timing') return ES.timePricing[String(line.id).replace(/^time-/, '')] || line.name;
  if (line.id === 'extra-kids') return line.name.replace(/^Extra child \(over (\d+)\)$/, 'Niño adicional (más de $1)');
  if (line.kind === 'discount') return line.name.replace(/^Referral discount/, 'Descuento por referido');
  return line.name;
}
const themeName = (t, l) => (t && lang(l) === 'es' ? ES.themes[t.id] || t.name : t?.name);
const faqQuestion = (q, l) => (lang(l) === 'es' ? ES.faq[q] || q : q);
const faqAnswer = (q, a, l) => (lang(l) === 'es' ? ES.faqAnswers[q] || a : a);

/** "Still needed" items on the party details form. */
const MISSING_ES = { 'sport theme': 'tema deportivo', "birthday child's name": 'nombre del cumpleañero', age: 'edad', 'allergies (or "none")': 'alergias (o "ninguna")', 'photo of the birthday child': 'foto del cumpleañero', 'jersey number': 'número de camiseta' };
function missingText(m, l) {
  if (lang(l) !== 'es') return m;
  const s = /^shirt sizes for all (\d+) shirts$/.exec(m);
  return s ? `tallas de las ${s[1]} camisetas` : MISSING_ES[m] || m;
}

/** Notes shown under a quote. */
function noteText(n, l) {
  if (lang(l) !== 'es') return n;
  const m = /^Shirts need (.+?) to print/.exec(n);
  if (m) return `Las camisetas tardan ${m[1].replace('weeks', 'semanas').replace('days', 'días')} en imprimirse, así que no están incluidas para esta fecha a menos que agregue Impresión urgente de camisetas (en Recuerdos y regalos de fiesta).`;
  return n;
}

// ---------- dates & money ----------
const locale = (l) => (lang(l) === 'es' ? 'es-US' : 'en-US');
const fmtDate = (ymd, l, withYear = false) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(locale(l), { weekday: 'long', month: 'long', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });

module.exports = { noteText, missingText, ES, lang, packageText, addOnText, phaseLabel, unitLabel, localizeConfig, lineName, themeName, faqQuestion, faqAnswer, fmtDate, locale };
