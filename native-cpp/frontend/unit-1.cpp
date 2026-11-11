// Generated module. Do not edit.
#include "estatic_common.hpp"

double parseAnalysisJobs(std::string value) {
    if ((::ets::string_length(value) == 0.0)) {
        return 0.0;
    }
    double count = 0.0;
    for (double at = 0.0; (at < ::ets::string_length(value)); (at = (at + 1.0))) {
        const double digit = (::ets::string_charCodeAt(value, at) - 48.0);
        if (((digit < 0.0) || (digit > 9.0))) {
            return 0.0;
        }
        (count = ((count * 10.0) + digit));
        if ((count > 32.0)) {
            return 0.0;
        }
    }
    return ((count >= 1.0) ? count : 0.0);
}

double analysisJobs() {
    const auto value = environment(std::string("ESTATIC_ANALYSIS_JOBS"));
    return ((value == std::string("")) ? 1.0 : parseAnalysisJobs(value));
}

bool configureAnalysisJobs(std::string value) {
    return ((parseAnalysisJobs(value) > 0.0) && setEnvironment(std::string("ESTATIC_ANALYSIS_JOBS"), value));
}

bool configureAnalysisProfile() {
    return setEnvironment(std::string("ESTATIC_PROFILE_ANALYSIS"), std::string("1"));
}

std::vector<double> profileBegin() {
    if ((environment(std::string("ESTATIC_PROFILE_ANALYSIS")) != std::string("1"))) {
        return std::vector<double>();
    }
    return analysisUsage();
}

void profileEnd(std::string name, std::vector<double> before, std::string counts) {
    if ((before.size() == 0.0)) {
        return;
    }
    const auto after = analysisUsage();
    printError(ets::concat(std::string("frontend: profile "), name, std::string(" wall_ms="), numberToString((after[static_cast<std::size_t>(0.0)] - before[static_cast<std::size_t>(0.0)])), std::string(" cpu_ms="), numberToString((after[static_cast<std::size_t>(1.0)] - before[static_cast<std::size_t>(1.0)])), std::string(" self_peak_rss_kib="), numberToString(after[static_cast<std::size_t>(2.0)]), std::string(" worker_peak_rss_kib="), numberToString(after[static_cast<std::size_t>(3.0)]), ((counts == std::string("")) ? std::string("") : ets::concat(std::string(" "), counts))));
}

void ets_init_bootstrap_analysis_options_19a75f08() {
}
