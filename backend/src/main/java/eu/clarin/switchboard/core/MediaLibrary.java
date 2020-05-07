package eu.clarin.switchboard.core;

import eu.clarin.switchboard.app.config.UrlResolverConfig;
import eu.clarin.switchboard.core.xc.*;
import eu.clarin.switchboard.profiler.api.Profile;
import eu.clarin.switchboard.profiler.api.Profiler;
import eu.clarin.switchboard.profiler.api.ProfilingException;
import org.glassfish.jersey.media.multipart.ContentDisposition;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.file.Path;
import java.text.ParseException;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * MediaLibrary keeps records about datafiles, identified by uuids.
 * The records contain file paths, profiles, origin information.
 */
public class MediaLibrary {
    public static final int MAX_ALLOWED_REDIRECTS = 5;

    private static final ch.qos.logback.classic.Logger LOGGER = (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(MediaLibrary.class);

    private final DataStore dataStore;
    private final Profiler profiler;
    private final StoragePolicy storagePolicy;
    private final UrlResolverConfig urlResolverConfig;

    Map<UUID, FileInfo> fileInfoMap = Collections.synchronizedMap(new HashMap<>());

    public MediaLibrary(DataStore dataStore, Profiler profiler, StoragePolicy storagePolicy, UrlResolverConfig urlResolverConfig) {
        this.dataStore = dataStore;
        this.profiler = profiler;
        this.storagePolicy = storagePolicy;
        this.urlResolverConfig = urlResolverConfig;

        ExecutorService executor = Executors.newSingleThreadScheduledExecutor();
        Duration cleanup = storagePolicy.getCleanupPeriod();
        ((ScheduledExecutorService) executor).scheduleAtFixedRate(
                this::periodicCleanup,
                cleanup.getSeconds(),
                cleanup.getSeconds(),
                TimeUnit.SECONDS);
    }

    private static int getResponseCode(HttpURLConnection connection) throws LinkException {
        try {
            return connection.getResponseCode();
        } catch (IOException xc) {
            throw new LinkException(LinkException.Kind.RESPONSE_ERROR, "" + connection.getURL(), xc);
        } catch (RuntimeException xc) {
            Throwable cause = xc.getCause();
            if (cause instanceof IllegalArgumentException) {
                throw new LinkException(LinkException.Kind.BAD_URL, "" + connection.getURL(), xc);
            }
            throw xc;
        }
    }

    public FileInfo addMedia(String originalUrlOrDoiOrHandle) throws CommonException, ProfilingException {
        LinkMetadata.LinkInfo linkInfo;
        try {
            linkInfo = LinkMetadata.getLinkData(originalUrlOrDoiOrHandle);
        } catch (MalformedURLException xc) {
            throw new LinkException(LinkException.Kind.BAD_URL, originalUrlOrDoiOrHandle, xc);
        }

        HttpURLConnection connection;
        String downloadLink = linkInfo.downloadLink;
        String cookies = null;

        int redirects = 0;
        while (true) {
            try {
                connection = (HttpURLConnection) new URL(downloadLink).openConnection();
                connection.setConnectTimeout(urlResolverConfig.getConnectTimeout());
                connection.setReadTimeout(urlResolverConfig.getReadTimeout());
                if (cookies != null) {
                    connection.setRequestProperty("Cookie", cookies);
                }
            } catch (IOException xc) {
                throw new LinkException(LinkException.Kind.CONNECTION_ERROR, downloadLink, xc);
            }

            int status = getResponseCode(connection);
            if (status == HttpURLConnection.HTTP_MOVED_TEMP
                    || status == HttpURLConnection.HTTP_MOVED_PERM
                    || status == HttpURLConnection.HTTP_SEE_OTHER
                    || status == 307 /* TEMPORARY REDIRECT */) {
                downloadLink = connection.getHeaderField("Location");
                cookies = connection.getHeaderField("Set-Cookie");

                if (redirects >= MAX_ALLOWED_REDIRECTS) {
                    throw new LinkException(LinkException.Kind.TOO_MANY_REDIRECTS, downloadLink, 0);
                }
                redirects += 1;
            } else if (200 <= status && status < 300) {
                break; // good connection found
            } else {
                throw new LinkException(LinkException.Kind.STATUS_ERROR, downloadLink, status);
            }
        }

        try {
            String header = connection.getHeaderField("Content-Disposition");
            ContentDisposition disposition = new ContentDisposition(header);
            String name = disposition.getFileName();
            if (!DataStore.sanitize(name).isEmpty()) {
                linkInfo.filename = name;
            }
        } catch (ParseException xc) {
            // ignore
        }

        try (InputStream stream = connection.getInputStream()) {
            FileInfo fileInfo = addMedia(linkInfo.filename, stream);
            fileInfo.setLinksInfo(originalUrlOrDoiOrHandle, linkInfo.downloadLink, redirects);
            return fileInfo;
        } catch (IOException xc) {
            throw new LinkException(LinkException.Kind.DATA_STREAM_ERROR, "" + connection.getURL(), xc);
        }
    }

    public FileInfo addMedia(String filename, InputStream inputStream) throws
            StoragePolicyException, StorageException, ProfilingException {
        UUID id = UUID.randomUUID();
        Path path;
        try {
            path = dataStore.save(id, filename, inputStream);
        } catch (IOException xc) {
            throw new StorageException(xc);
        }

        FileInfo fileInfo = new FileInfo(id, filename, path);
        File file = path.toFile();

        try {
            List<Profile> profileList = profiler.profile(file);
            if (profileList == null || profileList.isEmpty()) {
                throw new ProfilingException("null profiling result");
            }
            fileInfo.setProfiles(
                    profileList.get(0),
                    profileList.subList(1, profileList.size())
            );
        } catch (IOException xc) {
            dataStore.delete(id, path);
            throw new StorageException(xc);
        } catch (ProfilingException xc) {
            dataStore.delete(id, path);
            throw xc;
        }

        fileInfoMap.put(id, fileInfo);

        try {
            storagePolicy.acceptProfile(fileInfo.getProfile());
        } catch (StoragePolicyException xc) {
            LOGGER.debug("profile not accepted: " + fileInfo);
            dataStore.delete(id, path);
            fileInfoMap.remove(id);
            throw xc;
        }

        return fileInfo;
    }

    public FileInfo getFileInfo(UUID id) {
        return fileInfoMap.get(id);
    }

    private void periodicCleanup() {
        // this runs on its own thread
        LOGGER.info("start periodic cleanup now");
        for (Iterator<FileInfo> iterator = fileInfoMap.values().iterator(); iterator.hasNext(); ) {
            FileInfo fi = iterator.next();
            Duration lifetime = Duration.between(fi.getCreation(), Instant.now());
            if (lifetime.compareTo(storagePolicy.getMaxAllowedLifetime()) > 0) {
                LOGGER.debug("removing entry: " + fi.getId());
                dataStore.delete(fi.getId(), fi.getPath());
                iterator.remove();
            }
        }
    }
}
