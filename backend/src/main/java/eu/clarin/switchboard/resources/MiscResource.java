package eu.clarin.switchboard.resources;

import eu.clarin.switchboard.core.Tool;
import eu.clarin.switchboard.core.ToolRegistry;
import org.slf4j.LoggerFactory;

import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@Path("")
public class MiscResource {
    private static final ch.qos.logback.classic.Logger LOGGER = (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(MiscResource.class);

    Map<String, String> gitProps;
    ToolRegistry toolRegistry;

    public MiscResource(ToolRegistry toolRegistry, Map<String, String> gitProps) {
        this.toolRegistry = toolRegistry;
        this.gitProps = gitProps == null ? new HashMap<>() : gitProps;
    }

    @GET
    @Path("/info")
    @Produces(MediaType.APPLICATION_JSON + ";charset=utf-8")
    public Response getApiInfo() {
        Map map = new HashMap<String, Object>() {{
            put("git", MiscResource.this.gitProps);
            put("version", MiscResource.this.gitProps.get("git.build.version"));
        }};
        return Response.ok(map).build();
    }

    @GET
    @Path("/mimetypes")
    @Produces(MediaType.APPLICATION_JSON + ";charset=utf-8")
    public Response getMediatypes() {
        Set<String> mediatypes = new HashSet<>();
        for (Tool tool: toolRegistry.getTools())
            mediatypes.addAll(tool.getMimetypes());
        return Response.ok(mediatypes).build();
    }

    @GET
    @Path("/languages")
    @Produces(MediaType.APPLICATION_JSON + ";charset=utf-8")
    public Response getLanguages() {
        Set<String> languages = new HashSet<>();
        for (Tool tool: toolRegistry.getTools())
            languages.addAll(tool.getLanguages());
        return Response.ok(languages).build();
    }
}
