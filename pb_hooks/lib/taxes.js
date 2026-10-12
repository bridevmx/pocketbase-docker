// Desglose de impuestos. Los precios de venta INCLUYEN impuestos (convención de comercio en México):
// con `with_taxes` el total de la partida se descompone; sin él, no se desglosa nada (total igual).
// Base gravable b: IEPS = b × i; IVA = (b + IEPS) × v; retenciones = b × r (informativas, no cambian el total).
const U = require(`${__hooks}/lib/util.js`);

// taxes: [{ id, type, percentage, is_exempt, is_withheld }]; total: importe con impuestos incluidos
function breakdown(total, taxes) {
  let ieps = 0, vat = 0;
  for (const t of taxes) {
    if (t.is_withheld || t.is_exempt) continue;
    if (t.type === 'ieps') ieps += t.percentage / 100;
    else if (t.type === 'vat') vat += t.percentage / 100;
  }
  // el IVA se calcula sobre base + IEPS; con varios del mismo tipo se suman las tasas
  const base = total / ((1 + ieps) * (1 + vat));
  const rows = taxes.map((t) => {
    let amount = 0;
    if (!t.is_exempt) {
      if (t.is_withheld) amount = base * t.percentage / 100;
      else if (t.type === 'ieps') amount = base * t.percentage / 100;
      else if (t.type === 'vat') amount = base * (1 + ieps) * t.percentage / 100;
    }
    return { tax: t.id, type: t.type, percentage: t.percentage, is_withheld: t.is_withheld, amount: U.r2(amount) };
  });
  return { base: U.r2(base), rows };
}

function load(app, ids) {
  return ids.map((id) => {
    const t = app.findRecordById('taxes', id);
    return { id: t.id, type: t.getString('type'), percentage: t.getFloat('percentage'), is_exempt: t.getBool('is_exempt'), is_withheld: t.getBool('is_withheld') };
  });
}

module.exports = { breakdown, load };
