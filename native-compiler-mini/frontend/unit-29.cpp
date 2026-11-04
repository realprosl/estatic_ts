// Generated module. Do not edit.
#include "estatic_common.hpp"

std::vector<IrIssue> verifyIr(IrProject project) {
    auto verifier = IrVerifier{}.constructor(project);
    return verifier.run();
}

void ets_init_bootstrap_ir_verify_0e1063ec() {
}
