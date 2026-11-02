// Isolated feasibility test. This module is not loaded by the LogEn application.
import {
  DwgReader, DwgWriter, Layer, Color, LwPolyline, LwPolylineVertex, XY,
} from '@node-projects/acad-ts';

export const additions = Object.freeze([
  { id: 'RACK-01', layer: 'POC_RACKS', color: 4, x: 4000, y: 6000, w: 2850, h: 1400 },
  { id: 'RACK-02', layer: 'POC_RACKS', color: 4, x: 4000, y: 11900, w: 2850, h: 1400 },
  { id: 'GROUND-01', layer: 'POC_GROUND', color: 3, x: 12000, y: 6000, w: 1300, h: 1100 },
]);

function xy(p) { return p ? [p.x, p.y] : null; }

function previewEntity(entity) {
  const type = entity.objectName;
  const result = { type, layer: entity.layer?.name ?? '0' };
  if (type === 'LWPOLYLINE') {
    result.points = entity.vertices.map(v => xy(v.location));
    result.closed = entity.isClosed;
    result.curved = entity.vertices.some(v => v.bulge !== 0);
  } else if (type === 'LINE') {
    result.points = [xy(entity.startPoint), xy(entity.endPoint)];
  } else if (type === 'CIRCLE') {
    result.center = xy(entity.center);
    result.radius = entity.radius;
  }
  return result;
}

export function makeProofDrawing(input, progress = () => {}) {
  if (!(input instanceof ArrayBuffer) || input.byteLength < 100) throw new Error('Choose a valid DWG file.');
  if (input.byteLength > 20 * 1024 * 1024) throw new Error('This isolated proof accepts DWG files up to 20 MB.');
  const inputHeader = new TextDecoder().decode(new Uint8Array(input, 0, 6));
  if (!/^AC\d{4}$/.test(inputHeader)) throw new Error('This is not a binary AutoCAD DWG file.');
  const started = performance.now();
  const notifications = [];
  const notify = (_sender, notice) => {
    if (notifications.length < 200) notifications.push({ message: String(notice.message), type: notice.notificationType ?? notice.type ?? null });
  };
  progress('Reading DWG locally…');
  const document = DwgReader.readFromStream(input, notify);
  if (Number(document.header.insUnits) !== 4) {
    throw new Error('This feasibility sample uses millimetres (INSUNITS = 4). The selected drawing uses a different or unspecified unit; it has not been changed.');
  }
  const original = Array.from(document.entities ?? []);
  if (original.length > 20000) throw new Error('This isolated proof is limited to 20,000 model-space entities.');
  const geometry = original.map(previewEntity);
  const counts = {};
  for (const entity of original) counts[entity.objectName] = (counts[entity.objectName] ?? 0) + 1;
  const readMs = performance.now() - started;

  progress('Adding two rack outlines and one ground-storage outline…');
  for (const spec of additions) {
    let layer = Array.from(document.layers).find(l => l.name === spec.layer);
    if (!layer) {
      layer = new Layer(spec.layer);
      layer.color = new Color(spec.color);
      document.layers.add(layer);
    }
    const { x, y, w, h } = spec;
    const entity = new LwPolyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      .map(([px, py]) => new LwPolylineVertex(new XY(px, py))));
    entity.isClosed = true;
    entity.layer = layer;
    document.modelSpace.entities.add(entity);
  }
  progress('Writing a binary DWG locally…');
  const bytes = DwgWriter.writeToBuffer(document, undefined, notify);
  const outputHeader = new TextDecoder().decode(bytes.subarray(0, 6));
  if (!/^AC\d{4}$/.test(outputHeader)) throw new Error('The CAD writer did not produce a binary DWG. No download was created.');
  const report = {
    test: 'LogEn isolated browser DWG feasibility / Phase A',
    library: '@node-projects/acad-ts', libraryVersion: '3.7.0', license: 'MIT',
    inputHeader, outputHeader, units: Number(document.header.insUnits), unitsName: 'millimetres',
    inputBytes: input.byteLength, outputBytes: bytes.byteLength,
    originalModelEntities: original.length, originalTypes: counts,
    outputModelEntities: Array.from(document.entities ?? []).length,
    added: additions, readMs: Math.round(readMs), totalMs: Math.round(performance.now() - started),
    notifications, geometry,
    scope: 'Fixed test positions, not the production warehouse optimizer. Independent CAD validation is required.',
    processing: 'In-memory JavaScript inside a dedicated browser worker. No upload, helper or server processing.',
    limitations: [
      'This is an isolated feasibility experiment; the LogEn production import/export is unchanged.',
      'Preview shows supported line, circle and polyline geometry; it is not a full CAD renderer.',
      'Known reader notifications must be reviewed; full fidelity for arbitrary DWG objects is not promised.',
      'Output version follows the source document. Only the included AC1032 sample is independently validated.',
      'A physical Android Chrome device has not yet been tested.',
    ],
  };
  return { bytes, report };
}
