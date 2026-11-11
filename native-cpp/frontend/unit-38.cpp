// Generated module. Do not edit.
#include "estatic_common.hpp"

static inline void runIr() {
    bool verbose = false;
    std::string entry = std::string("");
    auto options = LoaderOptions{}.constructor();
    for (double at = 1.0; (at < argumentCount()); (at = (at + 1.0))) {
        const std::string arg = argument(at);
        if ((arg == std::string("--profile-analysis"))) {
            if ((!configureAnalysisProfile())) {
                exitProcess(2.0);
            }
        } else {
            if ((arg == std::string("--jobs"))) {
                (at = (at + 1.0));
                if (((at >= argumentCount()) || (!configureAnalysisJobs(argument(at))))) {
                    printError(std::string("--jobs requiere un entero entre 1 y 32"));
                    exitProcess(2.0);
                }
            } else {
                if ((arg == std::string("--verbose"))) {
                    (verbose = true);
                    (options.verbose = true);
                } else {
                    if (((arg == std::string("--root")) || (arg == std::string("--cache")))) {
                        (at = (at + 1.0));
                        if ((at >= argumentCount())) {
                            exitProcess(2.0);
                        }
                        if ((arg == std::string("--root"))) {
                            ets_push_vec<std::string>(options.roots, normalizePath(argument(at)));
                        } else {
                            (options.cacheDirectory = argument(at));
                        }
                    } else {
                        if ((arg == std::string("--alias"))) {
                            if (((at + 2.0) >= argumentCount())) {
                                exitProcess(2.0);
                            }
                            ets_push_vec<PathAlias>(options.aliases, PathAlias{}.constructor(argument((at + 1.0)), argument((at + 2.0))));
                            (at = (at + 2.0));
                        } else {
                            if (((entry == std::string("")) && (!::ets::string_startsWith(arg, std::string("-"))))) {
                                (entry = arg);
                            } else {
                                exitProcess(2.0);
                            }
                        }
                    }
                }
            }
        }
    }
    if ((entry == std::string(""))) {
        printError(std::string("Expected source entry [--root path] [--alias name path] [--cache path]"));
        exitProcess(2.0);
    }
    auto loader = ModuleLoader{}.constructor(options);
    const auto graph = loader.load(entry);
    const auto project = analyzeProject(graph, verbose);
    auto diagnostics = project.graph.diagnostics;
    for (const auto& d : project.binding.diagnostics) {
        ets_push_vec<SourceDiagnostic>(diagnostics, d);
    }
    for (const auto& d : project.checked.diagnostics) {
        ets_push_vec<SourceDiagnostic>(diagnostics, d);
    }
    auto ir = IrProject{}.constructor();
    if ((diagnostics.size() == 0.0)) {
        if (verbose) {
            printError(std::string("frontend: lowering IR"));
        }
        (ir = lowerProject(project.graph, project.binding, project.checked, verbose));
    }
    std::vector<std::string> seen = std::vector<std::string>();
    for (const auto& d : diagnostics) {
        const std::string key = ets::concat(d.file, std::string(":"), numberToString(d.token.offset), std::string(":"), d.code, std::string(":"), d.message);
        if ((!ets_includes_vec<std::string>(seen, key))) {
            ets_push_vec<std::string>(seen, key);
            ets_push_vec<IrIssue>(ir.diagnostics, IrIssue{}.constructor(d.code, d.message, IrSource{}.constructor(std::string(""), std::string(""), d.file, (-1.0), d.token.offset, d.endToken.endOffset)));
        }
    }
    if (verbose) {
        printError(std::string("frontend: serializing verified IR"));
    }
    print(formatIr(ir));
    if ((!ir.success)) {
        exitProcess(1.0);
    }
}

void ets_init_bootstrap_ir_demo_47f3c1ee() {
    runIr();
}

int main(int argc, char** argv) {
    ets_argc = argc;
    ets_argv = argv;
    ets_init_bootstrap_driver_host_5f952991();
    ets_init_bootstrap_analysis_options_19a75f08();
    ets_init_bootstrap_progress_progress_cb3e8773();
    ets_init_bootstrap_parser_ast_schema_1304e857();
    ets_init_bootstrap_parser_parser_42b9bbf9();
    ets_init_bootstrap_lexer_lexer_935c1bee();
    ets_init_bootstrap_frontend_frontend_a7343264();
    ets_init_bootstrap_modules_platform_562cee50();
    ets_init_bootstrap_modules_syntax_cache_85567346();
    ets_init_bootstrap_modules_loader_43fa4e97();
    ets_init_bootstrap_frontend_builtins_4364c337();
    ets_init_bootstrap_binder_binder_c1b23e8f();
    ets_init_bootstrap_checker_types_43cdcefd();
    ets_init_bootstrap_checker_model_f556179b();
    ets_init_bootstrap_checker_module_records_2a01df70();
    ets_init_bootstrap_checker_constant_ee47b975();
    ets_init_bootstrap_checker_numeric_6ffed12d();
    ets_init_bootstrap_checker_comptime_453edd1a();
    ets_init_bootstrap_checker_effects_4dbf2bf9();
    ets_init_bootstrap_checker_ownership_f220c326();
    ets_init_bootstrap_checker_safety_8aa4dfdf();
    ets_init_bootstrap_checker_checker_c354a49e();
    ets_init_bootstrap_checker_expansion_5b48ea3d();
    ets_init_bootstrap_ir_model_774eb4bb();
    ets_init_bootstrap_ir_type_traits_d9a7fcbe();
    ets_init_bootstrap_ir_borrows_58af27bc();
    ets_init_bootstrap_ir_contracts_d1083918();
    ets_init_bootstrap_ir_verify_contracts_f5e4a2f8();
    ets_init_bootstrap_ir_verify_ownership_e7778628();
    ets_init_bootstrap_ir_verify_shapes_625a5811();
    ets_init_bootstrap_ir_verify_memory_3e10e805();
    ets_init_bootstrap_ir_verify_borrows_1aebe09f();
    ets_init_bootstrap_ir_verify_d09f62ef();
    ets_init_bootstrap_ir_lower_2184539b();
    ets_init_bootstrap_binder_format_d243f694();
    ets_init_bootstrap_ir_format_source_03178004();
    ets_init_bootstrap_ir_format_contracts_1cbcd575();
    ets_init_bootstrap_ir_format_5756b67d();
    ets_init_bootstrap_ir_demo_47f3c1ee();
    return 0;
}
