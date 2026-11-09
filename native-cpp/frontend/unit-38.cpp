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

void ets_init_bootstrap_ir_demo_b3577aad() {
    runIr();
}

int main(int argc, char** argv) {
    ets_argc = argc;
    ets_argv = argv;
    ets_init_bootstrap_driver_host_5cdd6c7b();
    ets_init_bootstrap_analysis_options_876b7c37();
    ets_init_bootstrap_progress_progress_0809dea3();
    ets_init_bootstrap_parser_ast_schema_c87a5319();
    ets_init_bootstrap_parser_parser_c7f03350();
    ets_init_bootstrap_lexer_lexer_139a0aad();
    ets_init_bootstrap_frontend_frontend_71598122();
    ets_init_bootstrap_modules_platform_5ca8746a();
    ets_init_bootstrap_modules_syntax_cache_b49b13e5();
    ets_init_bootstrap_modules_loader_2e111b50();
    ets_init_bootstrap_frontend_builtins_a4273184();
    ets_init_bootstrap_binder_binder_1367c37e();
    ets_init_bootstrap_checker_types_f1a5f64a();
    ets_init_bootstrap_checker_model_d9eb2c5e();
    ets_init_bootstrap_checker_module_records_e828114e();
    ets_init_bootstrap_checker_constant_10a3e67c();
    ets_init_bootstrap_checker_numeric_99db9de7();
    ets_init_bootstrap_checker_comptime_14465de6();
    ets_init_bootstrap_checker_effects_26f81858();
    ets_init_bootstrap_checker_ownership_f6ad3ebb();
    ets_init_bootstrap_checker_safety_88c3403a();
    ets_init_bootstrap_checker_checker_b1f45756();
    ets_init_bootstrap_checker_expansion_c15c8aed();
    ets_init_bootstrap_ir_model_e1b1176c();
    ets_init_bootstrap_ir_type_traits_55205947();
    ets_init_bootstrap_ir_borrows_34b30c88();
    ets_init_bootstrap_ir_contracts_946405c8();
    ets_init_bootstrap_ir_verify_contracts_15f5a5a4();
    ets_init_bootstrap_ir_verify_ownership_b1da2c6e();
    ets_init_bootstrap_ir_verify_shapes_a43248b9();
    ets_init_bootstrap_ir_verify_memory_9a5f20b0();
    ets_init_bootstrap_ir_verify_borrows_7094b439();
    ets_init_bootstrap_ir_verify_093cf4d0();
    ets_init_bootstrap_ir_lower_45e87b9b();
    ets_init_bootstrap_binder_format_2b22398f();
    ets_init_bootstrap_ir_format_source_bf72ebe4();
    ets_init_bootstrap_ir_format_contracts_3e2a3d6a();
    ets_init_bootstrap_ir_format_40e08632();
    ets_init_bootstrap_ir_demo_b3577aad();
    return 0;
}
