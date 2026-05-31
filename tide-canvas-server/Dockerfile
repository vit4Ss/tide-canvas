# ====== Stage 1: Build ======
FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src ./src
RUN mvn package -DskipTests -B

# ====== Stage 2: Run ======
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

COPY --from=builder /build/target/tide-canvas-server-1.0.0.jar app.jar

RUN mkdir -p /app/uploads

EXPOSE 8080

ENV JAVA_OPTS="-Xms256m -Xmx512m"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar --spring.profiles.active=${SPRING_PROFILES_ACTIVE:-docker}"]
