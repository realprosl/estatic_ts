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

void ets_init_bootstrap_ir_demo_afe9bd11() {
    runIr();
}

int main(int argc, char** argv) {
    ets_argc = argc;
    ets_argv = argv;
    ets_init_bootstrap_driver_host_862efdc1();
    ets_init_bootstrap_analysis_options_94e9913b();
    ets_init_bootstrap_progress_progress_0365d9f9();
    ets_init_bootstrap_parser_ast_schema_5289349f();
    ets_init_bootstrap_parser_parser_ac18791a();
    ets_init_bootstrap_lexer_lexer_df27c6e7();
    ets_init_bootstrap_frontend_frontend_7a900e75();
    ets_init_bootstrap_modules_platform_8fe6afba();
    ets_init_bootstrap_modules_syntax_cache_bfc8ae19();
    ets_init_bootstrap_modules_loader_ac8191d2();
    ets_init_bootstrap_frontend_builtins_ab6c0609();
    ets_init_bootstrap_binder_binder_1c5e05a6();
    ets_init_bootstrap_checker_types_71b4ed17();
    ets_init_bootstrap_checker_model_80275e1b();
    ets_init_bootstrap_checker_module_records_d933f8fe();
    ets_init_bootstrap_checker_constant_4f712795();
    ets_init_bootstrap_checker_numeric_16be9374();
    ets_init_bootstrap_checker_comptime_0c032780();
    ets_init_bootstrap_checker_effects_d6dfccb9();
    ets_init_bootstrap_checker_ownership_0086a83d();
    ets_init_bootstrap_checker_safety_19515c74();
    ets_init_bootstrap_checker_checker_80aa1e2f();
    ets_init_bootstrap_checker_expansion_7e0d4139();
    ets_init_bootstrap_ir_model_7080054c();
    ets_init_bootstrap_ir_type_traits_ecea0c3b();
    ets_init_bootstrap_ir_borrows_2fdc1506();
    ets_init_bootstrap_ir_contracts_141fd47f();
    ets_init_bootstrap_ir_verify_contracts_18b4bee9();
    ets_init_bootstrap_ir_verify_ownership_450ec18e();
    ets_init_bootstrap_ir_verify_shapes_14484802();
    ets_init_bootstrap_ir_verify_memory_d2465644();
    ets_init_bootstrap_ir_verify_borrows_978ac375();
    ets_init_bootstrap_ir_verify_0e1063ec();
    ets_init_bootstrap_ir_lower_d645e93b();
    ets_init_bootstrap_binder_format_427ab3d5();
    ets_init_bootstrap_ir_format_source_2b0cfb6e();
    ets_init_bootstrap_ir_format_contracts_912d0d90();
    ets_init_bootstrap_ir_format_60a49266();
    ets_init_bootstrap_ir_demo_afe9bd11();
    return 0;
}
