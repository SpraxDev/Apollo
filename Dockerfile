# syntax=docker/dockerfile:1
FROM debian:buster-slim

LABEL maintainer="Christian Koop <contact@sprax2013.de>"

EXPOSE 8092
VOLUME ["/app/storage/", "/app/WORKING_DIR/"]

RUN echo 'deb http://deb.debian.org/debian buster-backports main' > /etc/apt/sources.list.d/backports.list

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y wget


###
# Vips
###
ENV vipsVersion=8.11.2 vipsCompilePackages="glib2.0-dev \
                                            libcfitsio-dev \
                                            libexpat1-dev \
                                            libfftw3-3 \
                                            libfftw3-dev \
                                            libgif-dev \
                                            libgirepository1.0-dev \
                                            libgsf-1-dev \
                                            libheif-dev \
                                            libimagequant-dev \
                                            libjpeg-dev \
                                            libmagick++-6.q16-dev \
                                            libmatio-dev \
                                            libnifti-dev \
                                            liborc-0.4-dev \
                                            libpango1.0-dev \
                                            libpoppler-glib-dev \
                                            libtiff5-dev \
                                            libwebm-dev \
                                            libwebp-dev"

RUN apt-get update && \
    apt-get install -y build-essential pkg-config ${vipsCompilePackages} && \
    mkdir -p /tmp/libvips/ && \
    cd /tmp/libvips/ && \
    wget https://github.com/libvips/libvips/releases/download/v${vipsVersion}/vips-${vipsVersion}.tar.gz && \
    tar xf vips-${vipsVersion}.tar.gz && \
    cd ./vips-${vipsVersion}/ && \
    ./configure && \
    make && \
    make install && \
    ldconfig && \
    rm -rf /tmp/libvips/ && \
    apt-get purge -y build-essential && \
    apt-get autoremove -y
ENV vipsCompilePackages="" vipsVersion=""


###
# Node.js
###
RUN wget -O - https://deb.nodesource.com/setup_14.x | bash && \
    apt-get install -y nodejs build-essential git && \
    rm -rf /var/lib/apt/lists/* && \
    npm i -g npm && \
    npm cache clean --force && \
    rm -r /tmp/npm-*


###
# ExifTool
###
RUN apt-get update && apt-get install -y libimage-exiftool-perl

###
# Additional stuff (e.g. fonts for HardSubbing)
###
RUN apt-get update && \
    apt-get install -y \
            fonts-liberation2 \
            fonts-arabeyes


###
# NASWeb
###
WORKDIR /app/

COPY package.json package-lock.json ./

ENV NODE_ENV=production
RUN npm i && \
    npm cache clean --force

COPY resources/ ./resources/
COPY build/ ./build/

CMD ["node", "--enable-source-maps", "build/index.js"]
