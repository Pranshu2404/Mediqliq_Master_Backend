package controller.validation

import constants.VALIDATION_ENDPOINT
import constants.VALIDATOR_VERSION_ENDPOINT
import constants.VALIDATION_PRESETS_ENDPOINT

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import model.ValidationRequest
import org.koin.ktor.ext.inject
import utils.badFileEntryExists
import java.security.MessageDigest

const val DEBUG_NUMBER_FILES = "Received %d files to validate."
const val NO_FILES_PROVIDED_MESSAGE = "No files for validation provided in request."
const val INVALID_FILE_MESSAGE = "Improperly formatted file content!"

private fun authorizedMasterRequest(call: ApplicationCall): Boolean {
    val configured = System.getenv("MEDIQLIQ_SERVICE_TOKEN")?.trim().orEmpty()
    if (configured.isEmpty()) {
        return System.getenv("NODE_ENV")?.equals("production", ignoreCase = true) != true
    }
    val bearer = call.request.headers[HttpHeaders.Authorization]
        ?.replace(Regex("^Bearer\\s+", RegexOption.IGNORE_CASE), "")
        ?.trim().orEmpty()
    val serviceIdentity = call.request.headers["X-MediQliq-Service-Identity"].orEmpty()
    val tenant = call.request.headers["X-MediQliq-Tenant-Code"].orEmpty()
    val facility = call.request.headers["X-MediQliq-Facility-ID"].orEmpty()
    return MessageDigest.isEqual(configured.toByteArray(), bearer.toByteArray()) &&
        serviceIdentity == "ABDM_MASTER" && tenant.isNotBlank() && facility.isNotBlank()
}

// org.hl7.fhir.* deprecation is intentional pending upstream API updates
@Suppress("DEPRECATION")
fun Route.validationModule() {

    val validationController by inject<ValidationController>()

    post(VALIDATION_ENDPOINT) {
        if (!authorizedMasterRequest(call)) {
            call.respond(HttpStatusCode.Unauthorized, "Unauthorized internal validation request")
            return@post
        }
        val logger = call.application.environment.log
        val request = call.receive<ValidationRequest>()
        logger.info("Received Validation Request. FHIR Version: ${request.validationContext.sv} IGs: ${request.validationContext.igs} Memory (free/max): ${java.lang.Runtime.getRuntime().freeMemory()}/${java.lang.Runtime.getRuntime().maxMemory()}")
        logger.debug(DEBUG_NUMBER_FILES.format(request.filesToValidate.size))
        // Never log submitted FHIR content. It contains ePHI. Only the file
        // count and the pinned validation context are safe operational metadata.

        when {
            request.filesToValidate == null || request.filesToValidate.isEmpty() -> {
                call.respond(HttpStatusCode.BadRequest, NO_FILES_PROVIDED_MESSAGE)
            }
            badFileEntryExists(logger, request.filesToValidate, silent = true) -> {
                call.respond(HttpStatusCode.BadRequest, INVALID_FILE_MESSAGE)
            }
            else -> {
                try {
                    call.respond(HttpStatusCode.OK, validationController.validateRequest(request))
                } catch (e: Exception) {
                    logger.error("FHIR validation execution failed: ${e.javaClass.simpleName}")
                    call.respond(HttpStatusCode.InternalServerError, "FHIR validation failed")
                }
            }
        }
    }



    get(VALIDATOR_VERSION_ENDPOINT) {
        call.respond(HttpStatusCode.OK, validationController.getAppVersions())
    }

    get(VALIDATION_PRESETS_ENDPOINT) {
        call.respond(HttpStatusCode.OK, validationController.getValidationPresets())
    }
}
