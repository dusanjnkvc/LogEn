import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'domain.dart';
import 'editors.dart';
import 'services.dart';

const _yellow = Color(0xFFF5C518);
const _background = Color(0xFF101113);
const _surface = Color(0xFF191B1D);
const _line = Color(0xFF303235);
const _muted = Color(0xFF9DA2AA);
String _fixed(double value) =>
    (((value + value.sign * 1e-9) * 100).round() / 100).toStringAsFixed(2);
String _area(double? value) => value == null ? '—' : '${_fixed(value)} m²';
String _quantity(num? value) {
  if (value == null) return 'N/A';
  if (!value.isFinite) return '—';
  if (value != 0 && value.abs() < 0.000001) {
    return value.toStringAsExponential(4);
  }
  return value.toStringAsFixed(6).replaceFirst(RegExp(r'\.?0+$'), '');
}

String _coverageLabel(WarehouseSettings settings) =>
    switch (settings.coverageMode) {
      'custom' =>
        '${_quantity(settings.customCoverageDays)} days (project override)',
      _ => 'DOH from each imported part',
    };

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MainApp());
}

class MainApp extends StatelessWidget {
  const MainApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'LogEn',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: _background,
      colorScheme: const ColorScheme.dark(
        primary: _yellow,
        onPrimary: Colors.black,
        secondary: _yellow,
        surface: _surface,
        onSurface: Color(0xFFF2F3F4),
        outline: _line,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF111315),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: _line),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 16,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: const Color(0xFFF2F3F4),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          side: const BorderSide(color: _line),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
      dividerColor: _line,
    ),
    home: const _Dashboard(),
  );
}

class _Dashboard extends StatefulWidget {
  const _Dashboard();
  @override
  State<_Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<_Dashboard> {
  final _store = ProjectStore();
  final _workbooks = WorkbookService();
  final _search = TextEditingController();
  List<WarehouseProject> _projects = [];
  String? _selectedId;
  String? _loadError;
  bool _loading = true;
  bool _busy = false;
  String _query = '';
  WarehouseProject get _project =>
      _projects.firstWhere((project) => project.id == _selectedId);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      var projects = await _store.load();
      if (projects.isEmpty) {
        projects = [
          WarehouseProject(
            id: 'sample-warehouse',
            name: 'Main warehouse',
            sourceName: 'Sample inventory',
            parts: const [
              PartInput(
                partNumber: 'SAMPLE-001',
                qtyBox: 20,
                qtyOnPallet: 40,
                consumptionPerShift: 500,
                doh: 5,
                length: 1200,
                width: 800,
                height: 1000,
                stacking: 1,
              ),
            ],
          ),
        ];
        await _store.save(projects);
      }
      if (!mounted) return;
      setState(() {
        _projects = projects;
        _selectedId = projects.first.id;
        _loading = false;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _loadError = error.toString();
          _loading = false;
        });
      }
    }
  }

  void _message(String message, {bool error = false, SnackBarAction? action}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error
            ? const Color(0xFF8A3030)
            : const Color(0xFF353B31),
        duration: Duration(
          seconds: action != null
              ? 12
              : error
              ? 7
              : 4,
        ),
        action: action,
      ),
    );
  }

  Future<bool> _saveProject(
    WarehouseProject project, {
    bool isNew = false,
  }) async {
    setState(() => _busy = true);
    try {
      final next = isNew
          ? [..._projects, project]
          : _projects
                .map((item) => item.id == project.id ? project : item)
                .toList();
      await _store.save(next);
      if (!mounted) return false;
      setState(() {
        _projects = next;
        _selectedId = project.id;
      });
      return true;
    } catch (error) {
      _message('Changes could not be saved: $error', error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _settings() async {
    final current = _project;
    final settings = await showWarehouseSettings(context, current.settings);
    if (settings != null && mounted) {
      await _saveProject(current.copyWith(settings: settings));
    }
  }

  Future<void> _part({int? index}) async {
    final current = _project;
    final part = await showPartEditor(
      context,
      initial: index == null ? null : current.parts[index],
      settings: current.settings,
    );
    if (part == null || !mounted) return;
    final parts = [...current.parts];
    if (index == null) {
      parts.add(part);
    } else {
      parts[index] = part;
    }
    if (await _saveProject(current.copyWith(parts: parts))) {
      _message(index == null ? 'Part number added.' : 'Part number updated.');
    }
  }

  Future<void> _removePart(int index) async {
    final current = _project;
    final parts = [...current.parts]..removeAt(index);
    await _saveProject(current.copyWith(parts: parts));
  }

  Future<void> _newProject() async {
    final form = GlobalKey<FormState>();
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('New warehouse project'),
        content: SizedBox(
          width: 420,
          child: Form(
            key: form,
            child: TextFormField(
              controller: controller,
              autofocus: true,
              maxLength: 80,
              decoration: const InputDecoration(labelText: 'Project name'),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Enter a project name'
                  : null,
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (form.currentState!.validate()) {
                Navigator.pop(dialogContext, controller.text.trim());
              }
            },
            child: const Text('Create project'),
          ),
        ],
      ),
    );
    // Keep the controller alive through the dismissal animation.
    Future<void>.delayed(const Duration(milliseconds: 300), controller.dispose);
    if (name == null || !mounted) return;
    if (await _saveProject(
      WarehouseProject(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        name: name,
      ),
      isNew: true,
    )) {
      _search.clear();
      if (mounted) setState(() => _query = '');
    }
  }

  Future<void> _deleteProject() async {
    final originalProjects = [..._projects];
    final originalActiveId = _selectedId!;
    final project = _project;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete project?'),
        content: Text(
          '“${project.name}” contains ${project.parts.length} part '
          '${project.parts.length == 1 ? 'number' : 'numbers'}. '
          'Delete this project and its warehouse settings from this device? '
          'You can restore it with Undo immediately afterward.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            key: const Key('confirm-project-delete'),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB64F39),
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            icon: const Icon(Icons.delete_outline_rounded, size: 18),
            label: const Text('Delete project'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    WarehouseProject? emptyFallback;
    try {
      final next = originalProjects
          .where((item) => item.id != originalActiveId)
          .toList();
      if (next.isEmpty) {
        emptyFallback = WarehouseProject(
          id: 'empty-${DateTime.now().microsecondsSinceEpoch}',
          name: 'Main warehouse',
        );
        next.add(emptyFallback);
      }
      await _store.save(next);
      if (!mounted) return;
      setState(() {
        _projects = next;
        _selectedId = next.first.id;
        _query = '';
        _search.clear();
      });
      _message(
        'Deleted “${project.name}”.',
        action: SnackBarAction(
          label: 'Undo',
          onPressed: () => _undoDeletedProject(
            originalProjects,
            originalActiveId,
            emptyFallback,
          ),
        ),
      );
    } catch (error) {
      _message('Project could not be deleted: $error', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _undoDeletedProject(
    List<WarehouseProject> snapshot,
    String originalActiveId,
    WarehouseProject? emptyFallback,
  ) async {
    if (!mounted) return;
    setState(() => _busy = true);
    try {
      final restored = snapshot.firstWhere(
        (item) => item.id == originalActiveId,
      );
      // Restore the deleted project without replacing later edits to survivors.
      // Remove the automatic empty project only if the user has not changed it.
      final next = _projects
          .where((item) => !identical(item, emptyFallback))
          .toList();
      if (!next.any((item) => item.id == originalActiveId)) {
        final originalIndex = snapshot.indexWhere(
          (item) => item.id == originalActiveId,
        );
        next.insert(originalIndex.clamp(0, next.length), restored);
      }
      await _store.save(next);
      if (!mounted) return;
      setState(() {
        _projects = next;
        _selectedId = originalActiveId;
        _query = '';
        _search.clear();
      });
      _message('Restored “${restored.name}”.');
    } catch (error) {
      _message('Project could not be restored: $error', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _import() async {
    setState(() => _busy = true);
    try {
      final selection = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['xlsx'],
        withData: true,
      );
      if (selection == null) return;
      final file = selection.files.single;
      final bytes = file.bytes;
      if (bytes == null) {
        throw StateError(
          'The selected file could not be read. Select it again.',
        );
      }
      if (!mounted) return;
      final imported = _workbooks.importBytes(bytes, _project.settings);
      final updated = _project.copyWith(
        parts: imported.parts,
        sourceName: file.name,
        rawInputRows: imported.rawInputRows,
      );
      if (await _saveProject(updated)) {
        _search.clear();
        if (mounted) setState(() => _query = '');
        _message(
          'Imported ${imported.parts.length} part numbers.${imported.warnings.isEmpty ? '' : '\n${imported.warnings.join('\n')}'}',
          error: imported.warnings.isNotEmpty,
        );
      }
    } catch (error) {
      _message('Import failed: $error', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download({bool template = false}) async {
    setState(() => _busy = true);
    try {
      final Uint8List bytes = template
          ? _workbooks.templateBytes()
          : _workbooks.exportBytes(
              _project,
              calculateProject(_project.parts, _project.settings),
            );
      final projectName = _project.name.replaceAll(
        RegExp(r'[^a-zA-Z0-9_-]'),
        '_',
      );
      final destination = await FilePicker.platform.saveFile(
        dialogTitle: template
            ? 'Save Excel template'
            : 'Export warehouse comparison',
        fileName: template
            ? 'LogEn_Shift_Inventory_Template.xlsx'
            : 'LogEn_${projectName}_Results.xlsx',
        type: FileType.custom,
        allowedExtensions: const ['xlsx'],
        bytes: bytes,
      );
      if (destination != null || kIsWeb) {
        _message(
          template
              ? 'Excel template saved.'
              : 'Results workbook saved with all five worksheets.',
        );
      }
    } catch (error) {
      _message('Export failed: $error', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      backgroundColor: _background,
      toolbarHeight: 78,
      title: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.asset('assets/logen_logo.png', width: 46, height: 46),
          ),
          const SizedBox(width: 12),
          const Text(
            'LogEn',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 26),
          ),
        ],
      ),
      actions: const [
        Padding(
          padding: EdgeInsets.only(right: 20),
          child: Row(
            children: [
              Icon(Icons.offline_bolt_rounded, color: _yellow, size: 17),
              SizedBox(width: 6),
              Text(
                'OFFLINE',
                style: TextStyle(
                  color: _muted,
                  fontSize: 11,
                  letterSpacing: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(1),
        child: _busy
            ? const LinearProgressIndicator(minHeight: 2)
            : const Divider(height: 1),
      ),
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _loadError != null
        ? Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.error_outline,
                    color: Colors.redAccent,
                    size: 40,
                  ),
                  const SizedBox(height: 18),
                  Text(_loadError!, textAlign: TextAlign.center),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _load,
                    child: const Text('Retry loading projects'),
                  ),
                ],
              ),
            ),
          )
        : SingleChildScrollView(
            padding: EdgeInsets.all(
              MediaQuery.sizeOf(context).width < 600 ? 16 : 28,
            ),
            child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1520),
                child: _content(),
              ),
            ),
          ),
  );

  Widget _content() {
    final project = _project;
    final result = calculateProject(project.parts, project.settings);
    final partial = result.invalidCount > 0 || result.settingsErrors.isNotEmpty;
    final entries = result.results.indexed
        .where(
          (entry) => entry.$2.input.partNumber.toLowerCase().contains(
            _query.toLowerCase(),
          ),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 16,
          runSpacing: 16,
          children: [
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'WAREHOUSE INTELLIGENCE',
                  style: TextStyle(
                    color: _yellow,
                    fontSize: 11,
                    letterSpacing: 2,
                  ),
                ),
                SizedBox(height: 8),
                Text(
                  'Footprint comparison',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
                ),
                SizedBox(height: 7),
                Text(
                  'One inventory. Two storage scenarios.',
                  style: TextStyle(color: _muted),
                ),
              ],
            ),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                OutlinedButton.icon(
                  key: const Key('warehouse-settings'),
                  onPressed: _busy ? null : _settings,
                  icon: const Icon(Icons.tune_rounded, size: 18),
                  label: const Text('Warehouse settings'),
                ),
                FilledButton.icon(
                  onPressed: _busy ? null : () => _download(),
                  icon: const Icon(Icons.download_rounded, size: 18),
                  label: const Text('Export results'),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 26),
        _Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              LayoutBuilder(
                builder: (_, constraints) {
                  final selector = DropdownButtonFormField<String>(
                    key: ValueKey(_selectedId),
                    initialValue: _selectedId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Warehouse project',
                      prefixIcon: Icon(Icons.warehouse_outlined),
                    ),
                    items: _projects
                        .map(
                          (item) => DropdownMenuItem(
                            value: item.id,
                            child: Text(
                              item.name,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: _busy
                        ? null
                        : (value) {
                            setState(() {
                              _selectedId = value;
                              _query = '';
                              _search.clear();
                            });
                          },
                  );
                  final actions = Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _newProject,
                        icon: const Icon(Icons.add_rounded, size: 18),
                        label: const Text('New project'),
                      ),
                      OutlinedButton.icon(
                        key: const Key('project-delete'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFFEFAC8E),
                        ),
                        onPressed: _busy ? null : _deleteProject,
                        icon: const Icon(
                          Icons.delete_outline_rounded,
                          size: 18,
                        ),
                        label: const Text('Delete project'),
                      ),
                    ],
                  );
                  return constraints.maxWidth < 550
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            selector,
                            const SizedBox(height: 12),
                            actions,
                          ],
                        )
                      : Row(
                          children: [
                            Expanded(child: selector),
                            const SizedBox(width: 12),
                            actions,
                          ],
                        );
                },
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  FilledButton.icon(
                    onPressed: _busy ? null : _import,
                    icon: const Icon(Icons.upload_file_rounded, size: 18),
                    label: const Text('Import Excel'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : () => _download(template: true),
                    icon: const Icon(Icons.description_outlined, size: 18),
                    label: const Text('Download template'),
                  ),
                  OutlinedButton.icon(
                    key: const Key('add-part'),
                    onPressed: _busy ? null : () => _part(),
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: const Text('Add part'),
                  ),
                  Text(
                    project.sourceName ?? 'Manual inventory',
                    style: const TextStyle(color: _muted, fontSize: 12),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                'Per-shift pallet planning'
                '  ·  ${project.settings.shiftsPerDay} shifts/day (maximum 3)'
                '  ·  DOH: ${_coverageLabel(project.settings)}'
                '  ·  ${project.settings.rackLevels} rack levels'
                '  ·  ${project.settings.gangwayWidth.toStringAsFixed(0)} mm gangway'
                ' (full width)'
                '  ·  Saved on this device',
                style: const TextStyle(
                  color: _muted,
                  fontSize: 12,
                  height: 1.7,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Required pallets = ROUNDUP(Consumption per shift ÷ QTY in Box ÷ QTY boxes per Pallet, 0) × DOH × shifts per day. '
                'Round one shift first. Fractional final pallet totals are rounded up.',
                style: TextStyle(color: _muted, fontSize: 11, height: 1.6),
              ),
            ],
          ),
        ),
        const SizedBox(height: 22),
        if (partial) ...[
          _Notice(
            '${result.invalidCount} invalid part numbers. Floor totals include ${result.floorValidCount} calculable parts; rack totals include ${result.rackValidCount}. A rack-fit error does not exclude valid floor storage. Invalid rows remain visible in details and exports.${result.settingsErrors.isEmpty ? '' : '\n${result.settingsErrors.join('\n')}'}',
            error: true,
          ),
          const SizedBox(height: 18),
        ],
        LayoutBuilder(
          builder: (_, constraints) {
            final columns = constraints.maxWidth >= 1050
                ? 4
                : constraints.maxWidth >= 560
                ? 2
                : 1;
            final width = (constraints.maxWidth - (columns - 1) * 16) / columns;
            return Wrap(
              spacing: 16,
              runSpacing: 16,
              children: [
                _Kpi(
                  width: width,
                  title: 'PALLETS — WITHOUT GANGWAYS',
                  value: result.floorWithoutGangways,
                  id: 'kpi-floor-without',
                  description: 'Sum of Floor storage m²',
                  icon: Icons.inventory_2_outlined,
                  partial: partial,
                ),
                _Kpi(
                  width: width,
                  title: 'PALLETS — WITH GANGWAYS',
                  value: result.floorWithGangways,
                  id: 'kpi-floor-with',
                  icon: Icons.inventory_2_outlined,
                  allocated: true,
                  partial: partial,
                ),
                _Kpi(
                  width: width,
                  title: 'RACKS — WITHOUT GANGWAYS',
                  value: result.rackWithoutGangways,
                  id: 'kpi-rack-without',
                  icon: Icons.shelves,
                  partial: partial,
                ),
                _Kpi(
                  width: width,
                  title: 'RACKS — WITH GANGWAYS',
                  value: result.rackWithGangways,
                  id: 'kpi-rack-with',
                  icon: Icons.shelves,
                  allocated: true,
                  partial: partial,
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 22),
        const _Notice(
          'Floor with gangways = (Q / S) × L × (W + G) / 1,000,000. Q is required pallets; S is effective floor stacking, with Q / S unrounded. L, W and G use millimeters. Floor without gangways uses occupied rows and clearances; rack gangways use actual run frontage. These are planning estimates.',
        ),
        const SizedBox(height: 22),
        LayoutBuilder(
          builder: (_, constraints) => constraints.maxWidth >= 900
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 3, child: _comparison(result)),
                    const SizedBox(width: 20),
                    Expanded(flex: 2, child: _savings(result)),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _comparison(result),
                    const SizedBox(height: 20),
                    _savings(result),
                  ],
                ),
        ),
        const SizedBox(height: 22),
        _stats(result, project.parts.length),
        const SizedBox(height: 22),
        _Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Part number details',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 7),
              const Text(
                'Tap a part number to inspect formulas. Scroll horizontally for all results.',
                style: TextStyle(color: _muted, fontSize: 12),
              ),
              const SizedBox(height: 18),
              TextField(
                key: const Key('part-search'),
                controller: _search,
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: 'Search part numbers…',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          onPressed: () => setState(() {
                            _query = '';
                            _search.clear();
                          }),
                          icon: const Icon(Icons.close_rounded),
                        ),
                ),
              ),
              const SizedBox(height: 12),
              if (entries.isNotEmpty) ...[
                _planningTable(entries.map((entry) => entry.$2).toList()),
                const SizedBox(height: 24),
                const Text(
                  'Floor and rack footprint results',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 12),
              ],
              if (entries.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 32),
                  child: Text(
                    project.parts.isEmpty
                        ? 'No parts yet. Import Excel or add a part to begin.'
                        : 'No matching part numbers.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: _muted),
                  ),
                )
              else
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    headingRowColor: const WidgetStatePropertyAll(
                      Color(0xFF212427),
                    ),
                    columnSpacing: 28,
                    headingTextStyle: const TextStyle(
                      color: _muted,
                      fontWeight: FontWeight.w600,
                      fontSize: 11,
                    ),
                    dataTextStyle: const TextStyle(fontSize: 12),
                    columns: const [
                      DataColumn(label: Text('PART NUMBER / STATUS')),
                      DataColumn(
                        label: Text('REQUIRED\nPALLETS'),
                        numeric: true,
                      ),
                      DataColumn(label: Text('FLOOR\nSTACKING'), numeric: true),
                      DataColumn(
                        label: Text('FLOOR\nPOSITIONS'),
                        numeric: true,
                      ),
                      DataColumn(label: Text('FLOOR\nROWS'), numeric: true),
                      DataColumn(
                        label: Text('FLOOR STORAGE\nm²'),
                        numeric: true,
                      ),
                      DataColumn(
                        label: Text('FLOOR WITH\nGANGWAYS'),
                        numeric: true,
                      ),
                      DataColumn(
                        label: Text('RACK PALLETS\nPER SLOT'),
                        numeric: true,
                      ),
                      DataColumn(label: Text('RACK\nLEVELS'), numeric: true),
                      DataColumn(label: Text('RACK\nBAYS'), numeric: true),
                      DataColumn(label: Text('RACK\nRUNS'), numeric: true),
                      DataColumn(
                        label: Text('RACK WITHOUT\nGANGWAYS'),
                        numeric: true,
                      ),
                      DataColumn(
                        label: Text('RACK WITH\nGANGWAYS'),
                        numeric: true,
                      ),
                      DataColumn(label: Text('ACTIONS')),
                    ],
                    rows: entries.map((entry) {
                      final row = entry.$2;
                      DataCell count(int? value) =>
                          DataCell(Text(value?.toString() ?? '—'));
                      DataCell size(double? value) =>
                          DataCell(Text(_area(value)));
                      return DataRow(
                        color: row.isValid
                            ? null
                            : const WidgetStatePropertyAll(Color(0xFF30201F)),
                        cells: [
                          DataCell(
                            Tooltip(
                              message: row.errors.join('\n'),
                              child: TextButton.icon(
                                onPressed: () => showPartDetails(
                                  context,
                                  row,
                                  project.settings,
                                ),
                                icon: Icon(
                                  row.isValid
                                      ? Icons.check_circle_outline_rounded
                                      : Icons.error_outline_rounded,
                                  size: 15,
                                  color: row.isValid
                                      ? const Color(0xFF9BBF8D)
                                      : Colors.redAccent,
                                ),
                                label: Text(
                                  row.input.partNumber.isEmpty
                                      ? '(unnamed part)'
                                      : row.input.partNumber,
                                ),
                              ),
                            ),
                          ),
                          count(
                            row.isPlanningValid ? row.requiredPallets : null,
                          ),
                          count(
                            row.isFloorValid
                                ? row.floor?.effectiveStacking
                                : null,
                          ),
                          count(row.isFloorValid ? row.floor?.positions : null),
                          count(row.isFloorValid ? row.floor?.rows : null),
                          size(
                            row.isFloorValid ? row.floor?.storageArea : null,
                          ),
                          size(
                            row.isFloorValid ? row.floor?.withGangways : null,
                          ),
                          count(
                            row.isRackValid ? row.rack?.palletsPerSlot : null,
                          ),
                          count(row.isRackValid ? row.rack?.levels : null),
                          count(row.isRackValid ? row.rack?.bays : null),
                          count(row.isRackValid ? row.rack?.runs : null),
                          size(
                            row.isRackValid ? row.rack?.withoutGangways : null,
                          ),
                          size(row.isRackValid ? row.rack?.withGangways : null),
                          DataCell(
                            Row(
                              children: [
                                IconButton(
                                  tooltip: 'Edit part number',
                                  onPressed: _busy
                                      ? null
                                      : () => _part(index: entry.$1),
                                  icon: const Icon(
                                    Icons.edit_outlined,
                                    size: 18,
                                  ),
                                ),
                                IconButton(
                                  tooltip: 'Remove part number',
                                  onPressed: _busy
                                      ? null
                                      : () => _removePart(entry.$1),
                                  icon: const Icon(
                                    Icons.delete_outline_rounded,
                                    size: 18,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      );
                    }).toList(),
                  ),
                ),
              const SizedBox(height: 14),
              Text(
                '${entries.length} of ${project.parts.length} part numbers shown · ${result.invalidCount} invalid · all footprint values in m²\nWhole project Floor storage m²: ${_area(result.floorWithoutGangways)}',
                key: const Key('floor-storage-project-total'),
                style: const TextStyle(color: _muted, fontSize: 12),
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
        const Text(
          'LogEn · All calculations, Excel files and project settings stay on your device.',
          textAlign: TextAlign.center,
          style: TextStyle(color: _muted, fontSize: 11),
        ),
      ],
    );
  }

  Widget _planningTable(List<PartCalculation> rows) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Text(
        'Consumption per shift & required pallets',
        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
      const SizedBox(height: 8),
      const Text(
        'Raw pallet demand stays decimal for reference. Round it up for one shift first, '
        'then multiply by the selected DOH and shifts per day. The resulting whole pallets '
        'are used for both floor and rack storage.',
        style: TextStyle(color: _muted, fontSize: 12, height: 1.6),
      ),
      const SizedBox(height: 12),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingRowColor: const WidgetStatePropertyAll(Color(0xFF212427)),
          columnSpacing: 26,
          headingTextStyle: const TextStyle(
            color: _muted,
            fontWeight: FontWeight.w600,
            fontSize: 11,
          ),
          dataTextStyle: const TextStyle(fontSize: 12),
          columns: const [
            DataColumn(label: Text('PART NUMBER')),
            DataColumn(label: Text('QTY IN BOX'), numeric: true),
            DataColumn(label: Text('BOXES PER PALLET'), numeric: true),
            DataColumn(label: Text('PARTS PER PALLET'), numeric: true),
            DataColumn(label: Text('CONSUMPTION PER SHIFT'), numeric: true),
            DataColumn(label: Text('RAW PALLETS PER SHIFT'), numeric: true),
            DataColumn(label: Text('ROUNDUP PALLETS PER SHIFT'), numeric: true),
            DataColumn(label: Text('SHIFTS PER DAY'), numeric: true),
            DataColumn(label: Text('INPUT DOH'), numeric: true),
            DataColumn(label: Text('USED DOH'), numeric: true),
            DataColumn(label: Text('DAILY PARTS'), numeric: true),
            DataColumn(label: Text('PLANNED PALLETS PER DAY'), numeric: true),
            DataColumn(label: Text('REQUIRED PALLETS'), numeric: true),
          ],
          rows: rows.map((row) {
            final p = row.isPlanningValid ? row.planning : null;
            final number = row.input.partNumber;
            DataCell metric(num? value, [String? key]) => DataCell(
              Text(_quantity(value), key: key == null ? null : ValueKey(key)),
            );
            return DataRow(
              cells: [
                DataCell(Text(number.isEmpty ? '(unnamed part)' : number)),
                metric(p?.qtyBox),
                metric(p?.qtyOnPallet),
                metric(p?.partsPerPallet),
                metric(p?.consumptionPerShift, 'shift-$number'),
                metric(p?.palletsPerShift, 'raw-pallets-$number'),
                metric(p?.roundedPalletsPerShift, 'rounded-pallets-$number'),
                metric(_project.settings.shiftsPerDay),
                metric(row.input.doh),
                metric(p?.targetCoverageDays, 'used-doh-$number'),
                metric(p?.dailyConsumption, 'daily-$number'),
                metric(p?.plannedPalletsPerDay),
                metric(
                  row.isPlanningValid ? row.requiredPallets : null,
                  'required-$number',
                ),
              ],
            );
          }).toList(),
        ),
      ),
    ],
  );

  Widget _comparison(ProjectCalculation result) {
    final values = [
      result.floorWithoutGangways,
      result.floorWithGangways,
      result.rackWithoutGangways,
      result.rackWithGangways,
    ];
    final maximum = values.fold<double>(0, (a, b) => a > b ? a : b);
    const labels = [
      'Pallets · storage only',
      'Pallets · allocated gangways',
      'Racks · storage only',
      'Racks · allocated gangways',
    ];
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Four footprint scenarios',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 7),
          const Text(
            'Less floor area means a smaller footprint.',
            style: TextStyle(color: _muted, fontSize: 12),
          ),
          const SizedBox(height: 24),
          for (var index = 0; index < values.length; index++) ...[
            Row(
              children: [
                Expanded(
                  child: Text(
                    labels[index],
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _area(values[index]),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 9),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: maximum == 0 ? 0 : (values[index] / maximum).clamp(0, 1),
                minHeight: 9,
                backgroundColor: const Color(0xFF2C2F32),
                valueColor: AlwaysStoppedAnimation(
                  index < 2 ? _yellow : const Color(0xFF9CABB8),
                ),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ],
      ),
    );
  }

  Widget _savings(ProjectCalculation result) => _Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Rack space savings',
          style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 7),
        const Text(
          'Floor footprint − rack footprint',
          style: TextStyle(color: _muted, fontSize: 12),
        ),
        if (result.results.any(
          (row) => row.isFloorValid != row.isRackValid,
        )) ...[
          const SizedBox(height: 12),
          const _Notice(
            'Floor and rack totals cover different parts; savings compare partial inventories.',
          ),
        ],
        const SizedBox(height: 23),
        _savingLine(
          'Without gangways',
          result.savingWithoutGangways,
          result.savingWithoutGangwaysPercent,
        ),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Divider(height: 1),
        ),
        _savingLine(
          'With allocated gangways',
          result.savingWithGangways,
          result.savingWithGangwaysPercent,
        ),
        const SizedBox(height: 20),
        const Text(
          'Negative savings mean racks require more floor area. Percentages are unavailable when floor area is zero.',
          style: TextStyle(color: _muted, fontSize: 11, height: 1.6),
        ),
      ],
    ),
  );

  Widget _savingLine(String label, double value, double? percent) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(color: _muted, fontSize: 12)),
      const SizedBox(height: 9),
      Wrap(
        spacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            _area(value),
            style: TextStyle(
              fontSize: 25,
              fontWeight: FontWeight.w700,
              color: value < 0 ? const Color(0xFFEFAC8E) : _yellow,
            ),
          ),
          Text(
            percent == null ? 'N/A' : '${_fixed(percent)}%',
            style: const TextStyle(color: _muted, fontSize: 13),
          ),
        ],
      ),
    ],
  );

  Widget _stats(ProjectCalculation result, int importedCount) => _Panel(
    child: LayoutBuilder(
      builder: (_, constraints) {
        final stats = <(String, String)>[
          ('Imported part numbers', '$importedCount'),
          ('Required pallets', '${result.totalRequiredPallets}'),
          ('Floor positions', '${result.totalFloorPositions}'),
          ('Floor rows', '${result.totalFloorRows}'),
          ('Rack bays', '${result.totalRackBays}'),
          ('Rack runs', '${result.totalRackRuns}'),
          ('Floor allocated gangways', _area(result.floorGangwayArea)),
          ('Rack allocated gangways', _area(result.rackGangwayArea)),
        ];
        final columns = constraints.maxWidth >= 1000
            ? 4
            : constraints.maxWidth >= 500
            ? 3
            : 2;
        final width = (constraints.maxWidth - (columns - 1) * 16) / columns;
        return Wrap(
          spacing: 16,
          runSpacing: 24,
          children: [
            for (final stat in stats)
              SizedBox(
                width: width,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      stat.$1,
                      style: const TextStyle(color: _muted, fontSize: 11),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      stat.$2,
                      style: const TextStyle(
                        fontSize: 22,
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
  );
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: _surface,
      borderRadius: BorderRadius.circular(15),
      border: Border.all(color: _line),
    ),
    child: child,
  );
}

class _Kpi extends StatelessWidget {
  const _Kpi({
    required this.width,
    required this.title,
    required this.value,
    required this.id,
    required this.icon,
    this.allocated = false,
    this.partial = false,
    this.description,
  });
  final double width;
  final String title;
  final double value;
  final String id;
  final IconData icon;
  final bool allocated;
  final bool partial;
  final String? description;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: width,
    child: _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: _yellow, size: 23),
          const SizedBox(height: 17),
          SizedBox(
            height: 34,
            child: Text(
              title,
              style: const TextStyle(
                color: _muted,
                fontSize: 11,
                fontWeight: FontWeight.w600,
                height: 1.5,
              ),
            ),
          ),
          const SizedBox(height: 12),
          FittedBox(
            alignment: Alignment.centerLeft,
            fit: BoxFit.scaleDown,
            child: Text(
              _area(value),
              key: ValueKey(id),
              style: const TextStyle(
                fontSize: 29,
                fontWeight: FontWeight.w800,
                letterSpacing: -.5,
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            description ??
                (partial
                    ? 'Partial · calculable scenario rows'
                    : allocated
                    ? 'Allocated planning footprint'
                    : 'Storage-only footprint'),
            style: TextStyle(
              color: partial ? const Color(0xFFEFAC8E) : _muted,
              fontSize: 11,
            ),
          ),
        ],
      ),
    ),
  );
}

class _Notice extends StatelessWidget {
  const _Notice(this.message, {this.error = false});
  final String message;
  final bool error;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: (error ? Colors.redAccent : _yellow).withValues(alpha: .05),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(
        color: (error ? Colors.redAccent : _yellow).withValues(alpha: .2),
      ),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          error ? Icons.warning_amber_rounded : Icons.info_outline_rounded,
          color: error ? Colors.redAccent : _yellow,
          size: 19,
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Text(
            message,
            style: const TextStyle(color: _muted, fontSize: 12, height: 1.7),
          ),
        ),
      ],
    ),
  );
}
