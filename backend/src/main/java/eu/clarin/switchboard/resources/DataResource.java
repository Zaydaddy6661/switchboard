package eu.clarin.switchboard.resources;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.io.ByteStreams;
import eu.clarin.switchboard.core.ArchiveOps;
import eu.clarin.switchboard.core.Constants;
import eu.clarin.switchboard.core.FileInfo;
import eu.clarin.switchboard.core.MediaLibrary;
import eu.clarin.switchboard.profiler.api.Profile;
import org.apache.commons.io.IOUtils;
import org.glassfish.jersey.media.multipart.FormDataContentDisposition;
import org.glassfish.jersey.media.multipart.FormDataParam;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.http.HttpServletRequest;
import javax.ws.rs.*;
import javax.ws.rs.core.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipException;

@Path("/api/storage")
public class DataResource {
    private static final Logger LOGGER = LoggerFactory.getLogger(DataResource.class);
    private static final int MAX_INLINE_CONTENT = 4 * 1024;

    static ObjectMapper mapper = new ObjectMapper();
    MediaLibrary mediaLibrary;

    public DataResource(MediaLibrary mediaLibrary) {
        this.mediaLibrary = mediaLibrary;
    }

    @GET
    @Path("/{id}")
    public Response getFile(@PathParam("id") String idString, @QueryParam("mediatype") String mediatype) throws Throwable {
        FileInfo fi = getFileInfo(idString);
        if (fi == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }

        StreamingOutput fileStream = output -> {
            byte[] data = Files.readAllBytes(fi.getPath());
            output.write(data);
            output.flush();
        };

        Response.ResponseBuilder builder = Response.ok(fileStream);
        if (mediatype != null && !mediatype.isEmpty()) {
            builder.type(mediatype);
        } else {
            builder.type(fi.getProfile().toProfile().getMediaType());
        }
        builder.header("content-disposition", "attachment; filename=" + fi.getFilename());
        return builder.build();
    }

    @PUT
    @Path("/{id}")
    @Consumes(MediaType.TEXT_PLAIN)
    @Produces(MediaType.TEXT_PLAIN + ";charset=utf-8")
    public Response putContent(@PathParam("id") String idString, String content) throws Throwable {
        FileInfo fi = getFileInfo(idString);
        if (fi == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }

        String currentMediaType = fi.getProfile().toProfile().getMediaType();
        if (!currentMediaType.equals(MediaType.TEXT_PLAIN)) {
            return Response.status(Response.Status.UNSUPPORTED_MEDIA_TYPE).build();
        }

        mediaLibrary.setContent(fi.getId(), content);
        return Response.ok(content).type(MediaType.TEXT_PLAIN).build();
    }

    @GET
    @Path("/{id}/info")
    @Produces(MediaType.APPLICATION_JSON + ";charset=utf-8")
    public Response getFileInfo(@Context HttpServletRequest request, @PathParam("id") String idString)
            throws Throwable {
        FileInfo fi = getFileInfo(idString);
        if (fi == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }

        final String trimEnd = "/info";
        String localLink = request.getRequestURI();
        assert (localLink.endsWith(trimEnd));
        localLink = localLink.substring(0, localLink.length() - trimEnd.length());

        return fileInfoToResponse(URI.create(localLink), fi);
    }

    @POST
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON + ";charset=utf-8")
    public Response postFile(@Context HttpServletRequest request,
                             @FormDataParam("file") InputStream inputStream,
                             @FormDataParam("file") final FormDataContentDisposition contentDispositionHeader,
                             @FormDataParam("url") String url,
                             @FormDataParam("mimetype") String mimetype,
                             @FormDataParam("archiveID") String archiveID,
                             @FormDataParam("archiveEntryName") String archiveEntryName,
                             @FormDataParam("profile") String profileString
    ) throws Throwable {
        FileInfo fileInfo;
        if (contentDispositionHeader != null) {
            String filename = contentDispositionHeader.getFileName();
            fileInfo = mediaLibrary.addFile(filename, inputStream, null);
        } else if (url != null) {
            Profile profile = null;
            if (mimetype != null && !mimetype.isEmpty()) {
                profile = Profile.builder().mediaType(mimetype).build();
            }
            fileInfo = mediaLibrary.addByUrl(url, profile);
        } else if (archiveID != null && !archiveID.isEmpty()) {
            FileInfo fi = getFileInfo(archiveID);
            if (fi == null) {
                return Response.status(Response.Status.NOT_FOUND).build();
            }
            Profile profile = readProfile(profileString);
            fileInfo = mediaLibrary.addFromArchive(fi.getPath(), fi.getProfile().toProfile(), archiveEntryName, profile);
            if (archiveEntryName != null) {
                fileInfo.setSource(fi.getId(), archiveEntryName);
            }
        } else {
            return Response.status(400).entity("Please provide either a file or a url to download in the form").build();
        }

        URI localLink = UriBuilder.fromPath(request.getRequestURI())
                .path(fileInfo.getId().toString())
                .build();
        return fileInfoToResponse(localLink, fileInfo);
    }

    private Profile readProfile(String profileString) {
        if (profileString != null && !profileString.isEmpty()) {
            Profile.Flat flat;
            try {
                flat = mapper.readValue(profileString, Profile.Flat.class);
                return flat.toProfile();
            } catch (JsonProcessingException xc) {
                LOGGER.error("json conversion exception ", xc);
            }
        }
        return null;
    }

    static Response fileInfoToResponse(URI localLink, FileInfo fileInfo) {
        Map<String, Object> ret;
        try {
            ret = mapper.readValue(mapper.writeValueAsString(fileInfo), new TypeReference<Map<String, Object>>() {
            });
        } catch (JsonProcessingException xc) {
            LOGGER.error("json conversion exception ", xc);
            return Response.serverError().build();
        }
        ret.remove("path");
        ret.put("localLink", localLink);

        // add the file content
        File file = fileInfo.getPath().toFile();
        try (InputStream fin = new BufferedInputStream(new FileInputStream(file));
             InputStream in = ByteStreams.limit(fin, MAX_INLINE_CONTENT)
        ) {
            String preview = IOUtils.toString(in, StandardCharsets.UTF_8);
            if (preview != null && !preview.isEmpty()) {
                ret.put("content", preview);
                if (file.length() > MAX_INLINE_CONTENT) {
                    ret.put("contentIsIncomplete", true);
                }
            }
        } catch (IOException e) {
            LOGGER.warn("Cannot read file to return inline content: " + e.getMessage());
        }

        // LOGGER.debug("postFile returns: " + ret);
        return Response.ok(ret).build();
    }

    @GET
    @Path("/{id}/outline")
    @Produces(MediaType.APPLICATION_JSON + ";charset=utf-8")
    public Response getOutline(@Context HttpServletRequest request, @PathParam("id") String idString)
            throws Throwable {
        FileInfo fi = getFileInfo(idString);
        if (fi == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }

        if (fi.getProfile().toProfile().isMediaType(Constants.MEDIATYPE_ZIP)) {
            try {
                ArchiveOps.Outline outline = ArchiveOps.extractOutlineFromZip(fi.getPath().toFile());
                return Response.ok(outline).build();
            } catch (ZipException xc) {
                LOGGER.info("bad zip archive: " + xc.getMessage());
                return Response.status(Response.Status.NOT_ACCEPTABLE).entity(xc.getMessage()).build();
            }
        } else if (fi.getProfile().toProfile().isMediaType(Constants.MEDIATYPE_TAR)) {
            ArchiveOps.Outline outline = ArchiveOps.extractOutlineFromTar(fi.getPath().toFile());
            return Response.ok(outline).build();
        }

        return Response.status(Response.Status.NO_CONTENT).build();
    }

    private FileInfo getFileInfo(String idString) throws Throwable {
        UUID id;
        try {
            id = UUID.fromString(idString);
        } catch (IllegalArgumentException xc) {
            return null;
        }
        return mediaLibrary.waitForFileInfo(id);
    }
}
