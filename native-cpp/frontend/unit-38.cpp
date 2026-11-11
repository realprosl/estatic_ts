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

void ets_init_bootstrap_ir_demo_5ce06c10() {
    runIr();
}

int main(int argc, char** argv) {
    ets_argc = argc;
    ets_argv = argv;
    ets_init_bootstrap_driver_host_b5fb3be4();
    ets_init_bootstrap_analysis_options_30472a8c();
    ets_init_bootstrap_progress_progress_6e8dd651();
    ets_init_bootstrap_parser_ast_schema_7f0a373f();
    ets_init_bootstrap_parser_parser_4f930fc1();
    ets_init_bootstrap_lexer_lexer_347006bc();
    ets_init_bootstrap_frontend_frontend_876772d2();
    ets_init_bootstrap_modules_platform_38a23446();
    ets_init_bootstrap_modules_syntax_cache_a2301959();
    ets_init_bootstrap_modules_loader_d0784388();
    ets_init_bootstrap_frontend_builtins_2c1278e5();
    ets_init_bootstrap_binder_binder_a5e8f8bc();
    ets_init_bootstrap_checker_types_6ca42b67();
    ets_init_bootstrap_checker_model_a78070bc();
    ets_init_bootstrap_checker_module_records_3961b602();
    ets_init_bootstrap_checker_constant_dff64f83();
    ets_init_bootstrap_checker_numeric_53bb8068();
    ets_init_bootstrap_checker_comptime_c355f21e();
    ets_init_bootstrap_checker_effects_0428f9f1();
    ets_init_bootstrap_checker_ownership_f81ee18c();
    ets_init_bootstrap_checker_safety_5ec2ffb6();
    ets_init_bootstrap_checker_checker_4b925bc0();
    ets_init_bootstrap_checker_expansion_6d31a3c6();
    ets_init_bootstrap_ir_model_2ab66571();
    ets_init_bootstrap_ir_type_traits_d19a4c59();
    ets_init_bootstrap_ir_borrows_175a8e51();
    ets_init_bootstrap_ir_contracts_430bbff0();
    ets_init_bootstrap_ir_verify_contracts_322fe924();
    ets_init_bootstrap_ir_verify_ownership_e134f2b1();
    ets_init_bootstrap_ir_verify_shapes_fb898010();
    ets_init_bootstrap_ir_verify_memory_f7b0c869();
    ets_init_bootstrap_ir_verify_borrows_ef38de22();
    ets_init_bootstrap_ir_verify_41847ae1();
    ets_init_bootstrap_ir_lower_504d42e2();
    ets_init_bootstrap_binder_format_b59f8b20();
    ets_init_bootstrap_ir_format_source_f8a27d8a();
    ets_init_bootstrap_ir_format_contracts_270e346d();
    ets_init_bootstrap_ir_format_86a288c4();
    ets_init_bootstrap_ir_demo_5ce06c10();
    return 0;
}
