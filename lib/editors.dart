import 'package:flutter/material.dart';

import 'domain.dart';

const _yellow = Color(0xFFF5C518);
const _panel = Color(0xFF191B1D);
const _border = Color(0xFF303235);
const _muted = Color(0xFF9DA2AA);

Future<WarehouseSettings?> showWarehouseSettings(
  BuildContext context,
  WarehouseSettings initial,
) => showDialog<WarehouseSettings>(
  context: context,
  builder: (_) => _SettingsEditor(initial: initial),
);

Future<PartInput?> showPartEditor(
  BuildContext context, {
  PartInput? initial,
  WarehouseSettings? settings,
}) => showDialog<PartInput>(
  context: context,
  builder: (_) => _PartEditor(initial: initial, settings: settings),
);

Future<void> showPartDetails(
  BuildContext context,
  PartCalculation result,
  WarehouseSettings settings,
) => showDialog<void>(
  context: context,
  builder: (_) => _PartDetails(result: result, settings: settings),
);

String _number(num value) {
  if (!value.isFinite) return value.toString();
  return value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toString();
}

String _area(num value) =>
    '${(((value + value.sign * 1e-9) * 100).round() / 100).toStringAsFixed(2)} m²';
String _optional(num? value) => value == null ? 'N/A' : _number(value);

class _EditorFrame extends StatelessWidget {
  const _EditorFrame({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.body,
    required this.actions,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Widget body;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    return Dialog(
      backgroundColor: _panel,
      insetPadding: const EdgeInsets.all(16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: _border),
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 760,
          maxHeight: screen.height - 32,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 24, 16, 20),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(11),
                    decoration: BoxDecoration(
                      color: _yellow.withValues(alpha: .1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(icon, color: _yellow),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 5),
                        Text(subtitle, style: const TextStyle(color: _muted)),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: _border),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: body,
              ),
            ),
            const Divider(height: 1, color: _border),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
              child: Wrap(
                alignment: WrapAlignment.end,
                spacing: 10,
                runSpacing: 8,
                children: actions,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.title, {this.description});
  final String title;
  final String? description;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
            color: _yellow,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (description != null) ...[
          const SizedBox(height: 5),
          Text(
            description!,
            style: const TextStyle(color: _muted, height: 1.5),
          ),
        ],
      ],
    ),
  );
}

class _NumericField extends StatelessWidget {
  const _NumericField({
    required this.controller,
    required this.label,
    this.unit,
    this.whole = false,
    this.positive = false,
  });

  final TextEditingController controller;
  final String label;
  final String? unit;
  final bool whole;
  final bool positive;

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: controller,
    keyboardType: TextInputType.numberWithOptions(decimal: !whole),
    decoration: InputDecoration(labelText: label, suffixText: unit),
    autovalidateMode: AutovalidateMode.onUserInteraction,
    validator: (value) {
      final parsed = double.tryParse(value?.trim() ?? '');
      if (parsed == null || !parsed.isFinite) return 'Enter a valid number';
      if (whole && parsed != parsed.roundToDouble()) {
        return 'Use a whole number';
      }
      if (positive ? parsed <= 0 : parsed < 0) {
        return positive ? 'Must be greater than zero' : 'Cannot be negative';
      }
      return null;
    },
  );
}

class _FieldGrid extends StatelessWidget {
  const _FieldGrid(this.children);
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (_, constraints) {
      final width = constraints.maxWidth < 470
          ? constraints.maxWidth
          : (constraints.maxWidth - 16) / 2;
      return Wrap(
        spacing: 16,
        runSpacing: 18,
        children: [
          for (final child in children) SizedBox(width: width, child: child),
        ],
      );
    },
  );
}

class _SettingsEditor extends StatefulWidget {
  const _SettingsEditor({required this.initial});
  final WarehouseSettings initial;

  @override
  State<_SettingsEditor> createState() => _SettingsEditorState();
}

class _SettingsEditorState extends State<_SettingsEditor> {
  final _form = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _fields;
  late int _shifts;
  late String _coverageMode;
  late bool _rotation;
  List<String> _errors = [];

  static const _labels = <String, String>{
    'customCoverageDays': 'Project DOH override',
    'maxFloorStackingHeight': 'Maximum stacking height',
    'maxFloorRowDepth': 'Maximum row depth (0 = unrestricted)',
    'gangwayWidth': 'Gangway width',
    'floorPalletClearance': 'Pallet clearance',
    'rackLevels': 'Rack levels',
    'rackSlotLength': 'Usable slot length',
    'rackSlotDepth': 'Usable slot depth',
    'rackSlotHeight': 'Usable slot height',
    'rackStructuralLength': 'Structural length allowance',
    'rackStructuralDepth': 'Structural depth allowance',
    'rackStructuralHeight': 'Structural height allowance',
    'maxRackRunLength': 'Maximum run length',
    'rackFrontageClearance': 'Frontage clearance',
    'rackDepthClearance': 'Total depth clearance',
    'rackVerticalClearance': 'Vertical clearance',
  };

  @override
  void initState() {
    super.initState();
    final values = widget.initial.toJson();
    _fields = {
      for (final key in _labels.keys)
        key: TextEditingController(
          text: values[key] is num
              ? _number(values[key] as num)
              : values[key]?.toString() ?? '',
        ),
    };
    _shifts = widget.initial.shiftsPerDay.clamp(1, 3);
    _coverageMode = widget.initial.coverageMode == 'custom'
        ? 'custom'
        : 'input';
    _rotation = widget.initial.allowRotation;
    for (final field in _fields.values) {
      field.addListener(_refreshPreview);
    }
  }

  void _refreshPreview() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Widget _field(String key) => _NumericField(
    controller: _fields[key]!,
    label: _labels[key]!,
    unit: switch (key) {
      'rackLevels' => 'levels',
      'customCoverageDays' => 'days',
      _ => 'mm',
    },
    whole: key == 'rackLevels',
    positive: {
      'maxFloorStackingHeight',
      'rackLevels',
      'rackSlotLength',
      'rackSlotDepth',
      'rackSlotHeight',
      'maxRackRunLength',
    }.contains(key),
  );

  WarehouseSettings _draftSettings() {
    final values = widget.initial.toJson();
    for (final entry in _fields.entries) {
      final value = double.tryParse(entry.value.text.trim()) ?? double.nan;
      values[entry.key] = entry.key == 'rackLevels'
          ? (value.isFinite && value == value.truncateToDouble()
                ? value.toInt()
                : 0)
          : value;
    }
    return WarehouseSettings.fromJson(values).copyWith(
      shiftsPerDay: _shifts,
      allowRotation: _rotation,
      coverageMode: _coverageMode,
    );
  }

  String _gangwayAllocationHint() {
    final width = double.tryParse(_fields['gangwayWidth']!.text.trim());
    if (width == null || !width.isFinite || width < 0) {
      return 'Enter a valid full gangway width to preview the allocation.';
    }
    return 'Allocated gangway width = ${_number(_draftSettings().allocatedGangwayWidth)} mm '
        '(100% of configured width) for both floor and rack calculations.';
  }

  void _save() {
    if (!_form.currentState!.validate()) return;
    final settings = _draftSettings();
    final errors = settings.validate();
    if (errors.isNotEmpty) {
      setState(() => _errors = errors);
      return;
    }
    Navigator.of(context).pop(settings);
  }

  @override
  Widget build(BuildContext context) => _EditorFrame(
    icon: Icons.tune_rounded,
    title: 'Warehouse settings',
    subtitle: 'Saved to this project. All four results update automatically.',
    body: Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SectionHeading(
            'SHIFTS & DOH PLANNING',
            description:
                'Round pallet demand up for one shift first, then multiply by DOH and the number of shifts.',
          ),
          DropdownButtonFormField<int>(
            key: const Key('settings-shifts'),
            initialValue: _shifts,
            decoration: const InputDecoration(labelText: 'Shifts per day'),
            items: const [
              DropdownMenuItem(value: 1, child: Text('1 shift')),
              DropdownMenuItem(value: 2, child: Text('2 shifts')),
              DropdownMenuItem(value: 3, child: Text('3 shifts')),
            ],
            onChanged: (value) => setState(() => _shifts = value!),
          ),
          const SizedBox(height: 10),
          const Text(
            'Required pallets = CEILING(CEILING(consumption per shift ÷ QTY in Box ÷ QTY boxes per Pallet) × selected DOH × shifts per day). The outer ceiling only affects fractional DOH.',
            style: TextStyle(color: _muted, height: 1.6, fontSize: 12),
          ),
          const SizedBox(height: 18),
          DropdownButtonFormField<String>(
            key: const Key('settings-doh-source'),
            initialValue: _coverageMode,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'DOH source'),
            items: const [
              DropdownMenuItem(
                value: 'input',
                child: Text('DOH from each imported part'),
              ),
              DropdownMenuItem(
                value: 'custom',
                child: Text('Project DOH override'),
              ),
            ],
            onChanged: (value) => setState(() => _coverageMode = value!),
          ),
          const SizedBox(height: 18),
          _field('customCoverageDays'),
          const SizedBox(height: 18),
          _PlanningPreview(
            planning: calculatePart(
              const PartInput(
                partNumber: 'Preview example',
                qtyBox: 20,
                qtyOnPallet: 40,
                consumptionPerShift: 500,
                doh: 5,
                length: 1200,
                width: 800,
                height: 1000,
                stacking: 1,
              ),
              _draftSettings(),
            ).planning,
            example: true,
            shiftsPerDay: _shifts,
          ),
          const SizedBox(height: 28),
          const _SectionHeading(
            'FLOOR STORAGE & GANGWAYS',
            description:
                'Floor with gangways uses (Q / S) × L × (W + G) / 1,000,000, with unrounded Q / S and full gangway width G. Racks use actual run frontage × G.',
          ),
          _FieldGrid([
            _field('maxFloorStackingHeight'),
            _field('maxFloorRowDepth'),
            _field('gangwayWidth'),
            _field('floorPalletClearance'),
          ]),
          const SizedBox(height: 12),
          Text(
            _gangwayAllocationHint(),
            key: const Key('allocated-gangway-width'),
            style: const TextStyle(color: _muted, fontSize: 12, height: 1.6),
          ),
          const SizedBox(height: 28),
          const _SectionHeading(
            'PALLET RACKS',
            description:
                'Slot dimensions are usable space. Structural allowances add to the rack envelope.',
          ),
          _FieldGrid([
            _field('rackLevels'),
            _field('maxRackRunLength'),
            _field('rackSlotLength'),
            _field('rackSlotDepth'),
            _field('rackSlotHeight'),
            _field('rackFrontageClearance'),
            _field('rackDepthClearance'),
            _field('rackVerticalClearance'),
            _field('rackStructuralLength'),
            _field('rackStructuralDepth'),
            _field('rackStructuralHeight'),
          ]),
          const SizedBox(height: 14),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: const Text('Allow 90° pallet rotation'),
            subtitle: const Text(
              'Use the valid orientation with the highest slot capacity.',
              style: TextStyle(color: _muted),
            ),
            value: _rotation,
            onChanged: (value) => setState(() => _rotation = value),
          ),
          const SizedBox(height: 10),
          const _Notice(
            'Gangway-inclusive results use 100% of the configured gangway width. '
            'They do not represent an optimized physical warehouse layout.',
          ),
          if (_errors.isNotEmpty) ...[
            const SizedBox(height: 16),
            _Notice(_errors.join('\n'), error: true),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      FilledButton.icon(
        onPressed: _save,
        icon: const Icon(Icons.check_rounded, size: 18),
        label: const Text('Save settings'),
      ),
    ],
  );
}

class _PartEditor extends StatefulWidget {
  const _PartEditor({this.initial, this.settings});
  final PartInput? initial;
  final WarehouseSettings? settings;

  @override
  State<_PartEditor> createState() => _PartEditorState();
}

class _PartEditorState extends State<_PartEditor> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final Map<String, TextEditingController> _fields;
  WarehouseSettings get _settings =>
      widget.settings ?? const WarehouseSettings();

  @override
  void initState() {
    super.initState();
    final part = widget.initial == null
        ? null
        : normalizePart(widget.initial!, _settings);
    _name = TextEditingController(text: part?.partNumber ?? '');
    _fields = {
      'qtyBox': TextEditingController(text: _number(part?.qtyBox ?? 20)),
      'qtyOnPallet': TextEditingController(
        text: _number(part?.qtyOnPallet ?? 40),
      ),
      'consumptionPerShift': TextEditingController(
        text: _number(part?.consumptionPerShift ?? 500),
      ),
      'doh': TextEditingController(text: _number(part?.doh ?? 5)),
      'length': TextEditingController(text: _number(part?.length ?? 1200)),
      'width': TextEditingController(text: _number(part?.width ?? 800)),
      'height': TextEditingController(text: _number(part?.height ?? 1000)),
      'stacking': TextEditingController(text: _number(part?.stacking ?? 1)),
    };
    for (final field in _fields.values) {
      field.addListener(_refreshPreview);
    }
  }

  void _refreshPreview() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _name.dispose();
    for (final field in _fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  double _value(String key) =>
      double.tryParse(_fields[key]!.text.trim()) ?? double.nan;

  PartInput _draft() => PartInput.fromJson({
    ...?widget.initial?.toJson(),
    'partNumber': _name.text.trim().isEmpty ? 'Preview' : _name.text.trim(),
    for (final key in _fields.keys) key: _value(key),
    'providedCoverageDays': _value('doh'),
    'packagingInferred': false,
    'inputErrors': <String>[],
  });

  void _save() {
    if (!_form.currentState!.validate()) return;
    Navigator.of(context).pop(_draft());
  }

  Widget _field(
    String key,
    String label, {
    String? unit,
    bool whole = false,
    bool positive = false,
  }) => _NumericField(
    controller: _fields[key]!,
    label: label,
    unit: unit,
    whole: whole,
    positive: positive,
  );

  @override
  Widget build(BuildContext context) => _EditorFrame(
    icon: Icons.inventory_2_outlined,
    title: widget.initial == null ? 'Add a part number' : 'Edit part number',
    subtitle:
        'The eight Excel columns, plus an optional floor-stacking safety limit.',
    body: Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _name,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Part Number'),
            validator: (value) => value == null || value.trim().isEmpty
                ? 'Enter a part number'
                : null,
          ),
          const SizedBox(height: 24),
          _SectionHeading(
            'PACKAGING & CONSUMPTION PER SHIFT',
            description:
                '${_settings.shiftsPerDay} shifts/day. Round pallet demand for one shift before applying DOH.',
          ),
          _FieldGrid([
            _field(
              'qtyBox',
              'QTY in Box',
              unit: 'parts / box',
              whole: true,
              positive: true,
            ),
            _field(
              'qtyOnPallet',
              'QTY boxes per Pallet',
              unit: 'boxes / pallet',
              whole: true,
              positive: true,
            ),
            _field(
              'consumptionPerShift',
              'Consumption per shift',
              unit: 'parts / shift',
            ),
            _field('doh', 'DOH', unit: 'days'),
          ]),
          const SizedBox(height: 18),
          _PlanningPreview(
            planning: calculatePart(_draft(), _settings).planning,
            shiftsPerDay: _settings.shiftsPerDay,
          ),
          const SizedBox(height: 24),
          const _SectionHeading(
            'LOADED PALLET DIMENSIONS',
            description:
                'Include the pallet and its loaded goods in the height.',
          ),
          _FieldGrid([
            _field('length', 'Length', unit: 'mm', positive: true),
            _field('width', 'Width', unit: 'mm', positive: true),
            _field('height', 'Height', unit: 'mm', positive: true),
          ]),
          const SizedBox(height: 24),
          const _SectionHeading(
            'ADVANCED · FLOOR STACKING SAFETY',
            description:
                'The eight-column template defaults to one pallet high. Increase this only where floor stacking is physically permitted.',
          ),
          _FieldGrid([
            _field(
              'stacking',
              'Allowed floor stacking',
              unit: 'pallets',
              whole: true,
              positive: true,
            ),
          ]),
          const SizedBox(height: 20),
          const _Notice(
            'Consumption means individual parts per shift. QTY Box is parts per box; QTY on Pallet is boxes per pallet. '
            'Existing historical metadata is preserved when editing.',
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      FilledButton.icon(
        onPressed: _save,
        icon: const Icon(Icons.check_rounded, size: 18),
        label: Text(
          widget.initial == null ? 'Add part number' : 'Save part number',
        ),
      ),
    ],
  );
}

class _PlanningPreview extends StatelessWidget {
  const _PlanningPreview({
    required this.planning,
    this.example = false,
    this.shiftsPerDay = 2,
  });
  final PlanningCalculation? planning;
  final bool example;
  final int shiftsPerDay;

  @override
  Widget build(BuildContext context) {
    final p = planning;
    final metrics = p == null
        ? <(String, String)>[]
        : <(String, String)>[
            ('Parts per pallet', '${_number(p.partsPerPallet)} parts'),
            (
              'Consumption per shift',
              '${_number(p.consumptionPerShift)} parts/shift',
            ),
            (
              'Raw pallets per shift',
              '${_number(p.palletsPerShift)} pallets/shift',
            ),
            (
              'Rounded pallets per shift',
              '${p.roundedPalletsPerShift} pallets/shift',
            ),
            ('Selected DOH', '${_number(p.targetCoverageDays)} days'),
            ('Shifts per day', '$shiftsPerDay shifts'),
            (
              'Planned pallets per day',
              '${p.plannedPalletsPerDay} pallets/day',
            ),
            ('Daily consumption', '${_number(p.dailyConsumption)} parts/day'),
            (
              'Required parts · raw demand',
              '${_number(p.dailyConsumption * p.targetCoverageDays)} parts',
            ),
            ('Required pallets', '${p.requiredPallets} pallets'),
          ];
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _yellow.withValues(alpha: .04),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _yellow.withValues(alpha: .18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SectionHeading(
            example
                ? 'LIVE PREVIEW · SAMPLE PART'
                : 'LIVE PER-SHIFT PALLET PLANNING',
            description: example
                ? '20 parts/box · 40 boxes/pallet · 500 parts/shift · DOH 5.'
                : null,
          ),
          if (p == null)
            const Text(
              'Enter valid box quantities, consumption per shift, DOH and 1–3 shifts to preview.',
              style: TextStyle(color: _muted, height: 1.6),
            )
          else ...[
            LayoutBuilder(
              builder: (_, constraints) {
                final columns = constraints.maxWidth >= 550 ? 3 : 2;
                final width =
                    (constraints.maxWidth - 14 * (columns - 1)) / columns;
                return Wrap(
                  spacing: 14,
                  runSpacing: 18,
                  children: [
                    for (final metric in metrics)
                      SizedBox(
                        width: width,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              metric.$1,
                              style: const TextStyle(
                                color: _muted,
                                fontSize: 11,
                                height: 1.5,
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              metric.$2,
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                );
              },
            ),
            const SizedBox(height: 16),
            Text(
              'CEILING(${_number(p.consumptionPerShift)} ÷ ${_number(p.qtyBox)} ÷ ${_number(p.qtyOnPallet)}) × ${_number(p.targetCoverageDays)} DOH × $shiftsPerDay shifts = ${p.requiredPallets} required pallets. A final ceiling applies when DOH is fractional.',
              style: const TextStyle(color: _muted, fontSize: 12, height: 1.6),
            ),
            if (p.noConsumption) ...[
              const SizedBox(height: 12),
              const _Notice(
                'Per-shift consumption is zero, so required pallets are zero. No current stock quantity is assumed.',
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice(this.text, {this.error = false});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: (error ? Colors.redAccent : _yellow).withValues(alpha: .07),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(
        color: (error ? Colors.redAccent : _yellow).withValues(alpha: .25),
      ),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          error ? Icons.error_outline_rounded : Icons.info_outline_rounded,
          size: 18,
          color: error ? Colors.redAccent : _yellow,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(text, style: const TextStyle(fontSize: 12, height: 1.6)),
        ),
      ],
    ),
  );
}

class _DetailLine extends StatelessWidget {
  const _DetailLine(this.label, this.formula, {this.result});
  final String label;
  final String formula;
  final String? result;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: _border)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 5),
        SelectableText(
          formula,
          style: const TextStyle(color: _muted, height: 1.6, fontSize: 12),
        ),
        if (result != null) ...[
          const SizedBox(height: 5),
          Text(
            result!,
            style: const TextStyle(color: _yellow, fontWeight: FontWeight.w700),
          ),
        ],
      ],
    ),
  );
}

class _PartDetails extends StatelessWidget {
  const _PartDetails({required this.result, required this.settings});
  final PartCalculation result;
  final WarehouseSettings settings;

  @override
  Widget build(BuildContext context) {
    final part = result.input;
    final floor = result.floor;
    final rack = result.rack;
    final planning = result.planning;
    final front = rack?.rotated == true ? part.width : part.length;
    final depth = rack?.rotated == true ? part.length : part.width;
    final n = _number;
    return _EditorFrame(
      icon: Icons.functions_rounded,
      title: part.partNumber.isEmpty ? 'Unnamed part' : part.partNumber,
      subtitle: 'Calculation details · dedicated floor rows and rack bays',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (result.errors.isNotEmpty) ...[
            _Notice(result.errors.join('\n'), error: true),
            const SizedBox(height: 22),
          ],
          const _SectionHeading('PER-SHIFT PALLET PLANNING'),
          _DetailLine(
            'Loaded pallet dimensions',
            '${n(part.length)} × ${n(part.width)} × ${n(part.height)} mm (L × W × H)',
          ),
          if (planning != null) ...[
            _DetailLine(
              'Parts per pallet',
              '${n(planning.qtyBox)} parts/box × ${n(planning.qtyOnPallet)} boxes/pallet',
              result: '${n(planning.partsPerPallet)} parts/pallet',
            ),
            _DetailLine(
              'Raw pallets per shift',
              '${n(planning.consumptionPerShift)} parts/shift ÷ ${n(planning.qtyBox)} parts/box ÷ ${n(planning.qtyOnPallet)} boxes/pallet',
              result: '${n(planning.palletsPerShift)} pallets/shift',
            ),
            _DetailLine(
              'Round up for one shift first',
              'CEILING(${n(planning.palletsPerShift)})',
              result: '${planning.roundedPalletsPerShift} pallets/shift',
            ),
            _DetailLine(
              'Selected DOH and shifts',
              '${settings.coverageMode == 'custom' ? 'Project DOH override' : 'DOH from this part'}: ${n(planning.targetCoverageDays)} days\nShifts per day: ${settings.shiftsPerDay} (maximum 3)',
            ),
            _DetailLine(
              'Planned pallets per day',
              '${planning.roundedPalletsPerShift} rounded pallets/shift × ${settings.shiftsPerDay} shifts',
              result: '${planning.plannedPalletsPerDay} pallets/day',
            ),
            _DetailLine(
              'Daily consumption · raw parts',
              '${n(planning.consumptionPerShift)} parts/shift × ${settings.shiftsPerDay} shifts',
              result: '${n(planning.dailyConsumption)} parts/day',
            ),
            _DetailLine(
              'Required parts · raw demand',
              '${n(planning.dailyConsumption)} parts/day × ${n(planning.targetCoverageDays)} DOH',
              result: _optional(result.requiredParts),
            ),
            _DetailLine(
              'Required pallets · shared by both scenarios',
              'CEILING(CEILING(${n(planning.consumptionPerShift)} ÷ ${n(planning.qtyBox)} ÷ ${n(planning.qtyOnPallet)}) × ${n(planning.targetCoverageDays)} × ${settings.shiftsPerDay})\n'
                  '= CEILING(${planning.roundedPalletsPerShift} × ${n(planning.targetCoverageDays)} × ${settings.shiftsPerDay})',
              result: '${result.requiredPallets} pallets',
            ),
            const _Notice(
              'The pallet ceiling is applied per shift before multiplying by DOH and shifts. A final ceiling ensures whole pallets when DOH is fractional. Raw required parts are shown separately.',
            ),
            const SizedBox(height: 24),
            const _SectionHeading(
              'HISTORICAL STOCK · OPTIONAL METADATA',
              description:
                  'The eight-column input does not provide current stock. Unavailable stock values remain N/A and do not affect required pallets.',
            ),
            _DetailLine(
              'Current stock',
              planning.stockQty == null
                  ? 'N/A · stock quantity was not provided.'
                  : '${_optional(planning.stockQty)} stock parts ÷ ${n(planning.partsPerPallet)} parts/pallet',
              result: planning.currentPallets == null
                  ? 'N/A'
                  : '${_optional(planning.currentPallets)} pallets',
            ),
            _DetailLine(
              'Actual stock coverage',
              planning.actualCoverageDays == null
                  ? 'N/A · stock quantity or positive consumption is unavailable.'
                  : '${_optional(planning.stockQty)} stock parts ÷ ${n(planning.dailyConsumption)} parts/day',
              result: planning.actualCoverageDays == null
                  ? 'N/A'
                  : '${_optional(planning.actualCoverageDays)} days',
            ),
          ],
          const SizedBox(height: 28),
          const _SectionHeading('A / B · FLOOR PALLET STORAGE'),
          if (floor == null)
            const _Notice(
              'Floor storage cannot be calculated. Review the validation messages above.',
              error: true,
            )
          else ...[
            _DetailLine(
              'Maximum stacking by height',
              'FLOOR(${n(settings.maxFloorStackingHeight)} ÷ ${n(part.height)})',
              result: '${floor.maximumStacking} pallets',
            ),
            _DetailLine(
              'Effective stacking',
              'MIN(Allowed stacking, Maximum stacking) = MIN(${n(part.stacking)}, ${floor.maximumStacking})',
              result: '${floor.effectiveStacking} pallets',
            ),
            _DetailLine(
              'Floor pallet positions',
              'CEILING(${result.requiredPallets} ÷ ${floor.effectiveStacking})',
              result: '${floor.positions} positions',
            ),
            _DetailLine(
              'Pallets per row · depth limit',
              settings.maxFloorRowDepth == 0
                  ? 'Unrestricted row depth: one dedicated row holds all floor positions.'
                  : 'FLOOR((${n(settings.maxFloorRowDepth)} + ${n(settings.floorPalletClearance)}) '
                        '÷ (${n(part.length)} + ${n(settings.floorPalletClearance)}))',
              result: '${floor.palletsPerRow} pallets',
            ),
            _DetailLine(
              'Dedicated floor rows',
              'CEILING(${floor.positions} ÷ ${floor.palletsPerRow})',
              result: '${floor.rows} rows',
            ),
            _DetailLine(
              'Actual occupied floor row depth',
              'Sum of occupied depths = (${floor.positions} positions × ${n(part.length)} mm '
                  '+ (${floor.positions} − ${floor.rows}) gaps × ${n(settings.floorPalletClearance)} mm) / 1000\n'
                  'Deepest row: ${n(floor.rowDepth)} m · last row: ${floor.lastRowPallets} pallets / ${n(floor.lastRowDepth)} m',
              result:
                  '${n(floor.totalOccupiedDepth)} m total occupied row depth',
            ),
            _DetailLine(
              'A · Pallets without gangways',
              '(${n(part.width)} + ${n(settings.floorPalletClearance)}) / 1000 m row width '
                  '× ${n(floor.totalOccupiedDepth)} m total occupied depth',
              result: _area(floor.withoutGangways),
            ),
            _DetailLine(
              'Unrounded formula positions · Q / S',
              'Q / S = ${result.requiredPallets} ÷ ${floor.effectiveStacking} (unrounded)',
              result: n(floor.formulaPositions),
            ),
            _DetailLine(
              'Floor formula storage component',
              '(${result.requiredPallets} ÷ ${floor.effectiveStacking}) × ${n(part.length)} × ${n(part.width)} ÷ 1,000,000',
              result: _area(floor.formulaStorageArea),
            ),
            _DetailLine(
              'Allocated floor gangway area',
              '(${result.requiredPallets} ÷ ${floor.effectiveStacking}) × ${n(part.length)} × ${n(settings.gangwayWidth)} ÷ 1,000,000\n'
                  'Allocated gangway width = ${n(settings.gangwayWidth)} mm',
              result: _area(floor.gangwayArea),
            ),
            _DetailLine(
              'B · Pallets with allocated gangways',
              'SQM = (Q / S) × L × (W + G) / 1,000,000\n'
                  '= (${result.requiredPallets} ÷ ${floor.effectiveStacking}) × ${n(part.length)} × (${n(part.width)} + ${n(settings.gangwayWidth)}) ÷ 1,000,000',
              result: _area(floor.withGangways),
            ),
            const _Notice(
              'Q is required pallets; S is effective floor stacking limited by loaded height. Q / S stays unrounded in this formula. '
              'L and W are loaded pallet dimensions; G is the full gangway width. Floor without gangways separately uses occupied rows and pallet clearances.',
            ),
          ],
          const SizedBox(height: 28),
          const _SectionHeading('C / D · PALLET RACK STORAGE'),
          if (rack == null)
            const _Notice(
              'Rack storage cannot be calculated. Review the validation messages above.',
              error: true,
            )
          else ...[
            _DetailLine(
              'Pallet orientation',
              rack.rotated
                  ? 'Rotated 90°: width along frontage, length along depth.'
                  : 'Original: length along frontage, width along depth.',
              result: '${n(front)} mm frontage × ${n(depth)} mm depth',
            ),
            _DetailLine(
              'Rack depth and loaded height fit',
              'Depth: ${n(depth)} + ${n(settings.rackDepthClearance)} ≤ ${n(settings.rackSlotDepth)} mm\n'
                  'Height: ${n(part.height)} + ${n(settings.rackVerticalClearance)} ≤ ${n(settings.rackSlotHeight)} mm',
            ),
            _DetailLine(
              'Pallets per usable slot',
              'FLOOR((${n(settings.rackSlotLength)} − ${n(settings.rackFrontageClearance)}) '
                  '÷ (${n(front)} + ${n(settings.rackFrontageClearance)}))',
              result: '${rack.palletsPerSlot} pallets',
            ),
            _DetailLine(
              'Capacity per rack bay',
              '${rack.palletsPerSlot} pallets per slot × ${rack.levels} rack levels',
              result: '${rack.capacityPerBay} pallets',
            ),
            _DetailLine(
              'Required dedicated rack bays',
              'CEILING(${result.requiredPallets} ÷ ${rack.capacityPerBay})',
              result: '${rack.bays} bays',
            ),
            _DetailLine(
              'Effective bay envelope',
              'Length = ${n(settings.rackSlotLength)} + ${n(settings.rackStructuralLength)} = ${n(rack.effectiveBayLength)} mm\n'
                  'Depth = ${n(settings.rackSlotDepth)} + ${n(settings.rackStructuralDepth)} = ${n(rack.effectiveBayDepth)} mm\n'
                  'Height per level = ${n(settings.rackSlotHeight)} + ${n(settings.rackStructuralHeight)} = ${n(rack.effectiveBayHeight)} mm',
            ),
            _DetailLine(
              'C · Racks without gangways',
              '${rack.bays} bays × ${n(rack.effectiveBayLength)} mm × ${n(rack.effectiveBayDepth)} mm ÷ 1,000,000',
              result: _area(rack.withoutGangways),
            ),
            _DetailLine(
              'Maximum bays per rack run',
              'FLOOR(${n(settings.maxRackRunLength)} ÷ ${n(rack.effectiveBayLength)})',
              result: '${rack.maxBaysPerRun} bays',
            ),
            _DetailLine(
              'Required rack runs',
              'CEILING(${rack.bays} ÷ ${rack.maxBaysPerRun})\n'
                  'Bays per run: ${rack.baysPerRun.isEmpty ? 'none' : rack.baysPerRun.join(', ')}\n'
                  'Run lengths: ${rack.baysPerRun.isEmpty ? 'none' : rack.baysPerRun.map((bays) => '${n(bays * rack.effectiveBayLength / 1000)} m').join(', ')}',
              result: '${rack.runs} runs',
            ),
            _DetailLine(
              'Allocated rack gangway area',
              'Total run frontage × full gangway width = '
                  '(${rack.bays} × ${n(rack.effectiveBayLength)} / 1000 m) × ${n(settings.gangwayWidth)} / 1000 m\n'
                  'Allocated gangway width = ${n(settings.allocatedGangwayWidth)} mm',
              result: _area(rack.gangwayArea),
            ),
            _DetailLine(
              'D · Racks with allocated gangways',
              '${rack.withoutGangways.toStringAsFixed(4)} + ${rack.gangwayArea.toStringAsFixed(4)} m²',
              result: _area(rack.withGangways),
            ),
          ],
          const SizedBox(height: 22),
          const _Notice(
            'Each part uses dedicated floor rows and rack bays. Floor stacking does not apply to racks. '
            'Both scenarios use 100% of the configured gangway width. These are planning estimates; a physical layout must count shared gangways once.',
          ),
        ],
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Done'),
        ),
      ],
    );
  }
}
